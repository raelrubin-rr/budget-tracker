const { assertPlaidConfig, createPlaidClient, parseJsonBody, setCommonHeaders } = require('./_utils');
const { categorizeTransactions } = require('./_categorization');

const plaidClient = createPlaidClient();

function getPlaidErrorCode(error) {
  return error?.response?.data?.error_code || null;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildFallbackHoldingForAccount(account) {
  const absoluteValue = Math.abs(Number(account?.balances?.current || 0));
  const baseSymbol = (account?.subtype || account?.type || 'account').toUpperCase().slice(0, 8);

  return [{
    symbol: baseSymbol,
    name: account?.name || 'Holding',
    weight: 100,
    value: absoluteValue,
    livePct: null,
    ytdPct: null,
  }];
}

function buildLiabilityDetails(account, liabilityByAccountId = {}) {
  const metric = `${account?.account_id || ''}${account?.subtype || ''}`.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const isLiability = ['credit', 'loan', 'liability'].includes((account?.type || '').toLowerCase());
  if (!isLiability) return {};

  const plaidLiability = liabilityByAccountId[account?.account_id] || {};
  const fallbackInterestRate = Number((8 + ((metric % 120) / 10)).toFixed(2));
  const plaidInterestRate = Number(plaidLiability.interestRate);
  const interestRate = Number.isFinite(plaidInterestRate) ? plaidInterestRate : fallbackInterestRate;
  const termMonths = 12 + ((metric % 84));

  const now = new Date();
  const fallbackNextPaymentDate = new Date(now.getFullYear(), now.getMonth() + 1, Math.max(1, (metric % 28) + 1));
  const parsedNextPaymentDate = plaidLiability.nextPaymentDate ? new Date(plaidLiability.nextPaymentDate) : null;
  const nextPaymentDate = parsedNextPaymentDate && !Number.isNaN(parsedNextPaymentDate.getTime())
    ? parsedNextPaymentDate
    : fallbackNextPaymentDate;

  const plaidPaymentAmount = Number(plaidLiability.paymentAmount);
  const fallbackPaymentAmount = Number((Math.max(25, Math.abs(Number(account?.balances?.current || 0)) * 0.035)).toFixed(2));
  const paymentAmount = Number.isFinite(plaidPaymentAmount) ? Number(plaidPaymentAmount.toFixed(2)) : fallbackPaymentAmount;

  return {
    interestRate,
    termMonths,
    nextPaymentDate: nextPaymentDate.toISOString().split('T')[0],
    paymentAmount,
  };
}

async function fetchInvestmentsHoldings(access_token) {
  try {
    const holdingsResponse = await plaidClient.investmentsHoldingsGet({ access_token });
    return holdingsResponse.data;
  } catch (error) {
    const plaidErrorCode = getPlaidErrorCode(error);
    const unsupportedErrors = new Set([
      'INVALID_PRODUCT',
      'PRODUCTS_NOT_SUPPORTED',
      'NO_LIABILITY_ACCOUNTS',
      'NO_INVESTMENT_ACCOUNTS',
      'PRODUCT_NOT_READY',
    ]);

    if (unsupportedErrors.has(plaidErrorCode)) {
      return { holdings: [], securities: [] };
    }

    throw error;
  }
}

async function fetchLiabilitiesData(access_token) {
  try {
    const liabilitiesResponse = await plaidClient.liabilitiesGet({ access_token });
    return liabilitiesResponse.data?.liabilities || {};
  } catch (error) {
    const plaidErrorCode = getPlaidErrorCode(error);
    const unsupportedErrors = new Set([
      'INVALID_PRODUCT',
      'PRODUCTS_NOT_SUPPORTED',
      'NO_LIABILITY_ACCOUNTS',
      'PRODUCT_NOT_READY',
    ]);

    if (unsupportedErrors.has(plaidErrorCode)) {
      return {};
    }

    throw error;
  }
}

function buildLiabilityByAccountId(liabilities = {}) {
  const liabilityByAccountId = {};

  (liabilities.credit || []).forEach((entry) => {
    const apr = Number(entry?.aprs?.[0]?.apr_percentage);
    if (!entry?.account_id) return;

    liabilityByAccountId[entry.account_id] = {
      interestRate: Number.isFinite(apr) ? Number(apr.toFixed(2)) : undefined,
      nextPaymentDate: entry?.next_payment_due_date,
      paymentAmount: Number(entry?.minimum_payment_amount),
    };
  });

  (liabilities.student || []).forEach((entry) => {
    (entry?.loans || []).forEach((loan) => {
      const apr = Number(loan?.interest_rate_percentage);
      if (!loan?.account_id) return;

      liabilityByAccountId[loan.account_id] = {
        interestRate: Number.isFinite(apr) ? Number(apr.toFixed(2)) : undefined,
        nextPaymentDate: loan?.next_payment_due_date,
        paymentAmount: Number(loan?.minimum_payment_amount),
      };
    });
  });

  (liabilities.mortgage || []).forEach((entry) => {
    const apr = Number(entry?.interest_rate?.percentage);
    if (!entry?.account_id) return;

    liabilityByAccountId[entry.account_id] = {
      interestRate: Number.isFinite(apr) ? Number(apr.toFixed(2)) : undefined,
      nextPaymentDate: entry?.next_payment_due_date,
      paymentAmount: Number(entry?.next_monthly_payment),
    };
  });

  return liabilityByAccountId;
}


async function fetchTransactionsWithRetry(access_token, start_date, end_date) {
  const maxAttempts = 4;
  const unsupportedErrors = new Set(['INVALID_PRODUCT', 'PRODUCTS_NOT_SUPPORTED']);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await plaidClient.transactionsGet({ access_token, start_date, end_date });
    } catch (error) {
      const plaidErrorCode = getPlaidErrorCode(error);
      if (unsupportedErrors.has(plaidErrorCode)) {
        return null;
      }
      const shouldRetry = plaidErrorCode === 'PRODUCT_NOT_READY' || plaidErrorCode === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION';

      if (!shouldRetry || attempt === maxAttempts) {
        throw error;
      }

      await wait(500 * attempt);
    }
  }

  throw new Error('Unable to fetch transactions');
}

module.exports = async (req, res) => {
  setCommonHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    assertPlaidConfig();

    const { access_token } = parseJsonBody(req);

    if (!access_token) {
      return res.status(400).json({ error: 'access_token is required' });
    }

    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const start_date = ninetyDaysAgo.toISOString().split('T')[0];
    const end_date = now.toISOString().split('T')[0];

    const response = await fetchTransactionsWithRetry(access_token, start_date, end_date);
    const accountsResponse = await plaidClient.accountsGet({ access_token });
    const investmentsData = await fetchInvestmentsHoldings(access_token);
    const liabilitiesData = await fetchLiabilitiesData(access_token);
    const liabilityByAccountId = buildLiabilityByAccountId(liabilitiesData);
    const accounts = accountsResponse.data.accounts;
    const securitiesById = (investmentsData.securities || []).reduce((acc, security) => {
      acc[security.security_id] = security;
      return acc;
    }, {});
    const holdingsByAccountId = (investmentsData.holdings || []).reduce((acc, holding) => {
      if (!acc[holding.account_id]) acc[holding.account_id] = [];
      acc[holding.account_id].push(holding);
      return acc;
    }, {});

    const sourceTransactions = response?.data?.transactions || [];
    const rawTransactions = sourceTransactions.map((tx) => {
      const account = accounts.find((acc) => acc.account_id === tx.account_id);
      const accountType = account?.type === 'credit' ? 'credit' : 'checking';
      const normalizedAmount = accountType === 'credit' ? -Math.abs(tx.amount) : -tx.amount;

      return {
        id: tx.transaction_id,
        accountId: tx.account_id,
        name: tx.name,
        amount: normalizedAmount,
        date: tx.date,
        pending: tx.pending,
        account: accountType,
        includeInBudget: accountType === 'checking' ? false : true,
        category: tx.category ? tx.category[0].toLowerCase() : 'other',
        merchant_name: tx.merchant_name,
        personal_finance_category: tx.personal_finance_category,
        reimbursable: 0,
        linkedDeposit: null,
      };
    });

    const transactions = (await categorizeTransactions(rawTransactions)).map(({ merchant_name, personal_finance_category, ...tx }) => tx);

    return res.status(200).json({
      transactions,
      accounts: accounts.map((acc) => {
        const accountHoldings = holdingsByAccountId[acc.account_id] || [];
        const holdingsTotal = accountHoldings.reduce((sum, holding) => sum + Math.abs(Number(holding.institution_value || 0)), 0);

        const mappedHoldings = accountHoldings.length
          ? accountHoldings.map((holding) => {
            const security = securitiesById[holding.security_id] || {};
            const value = Math.abs(Number(holding.institution_value || 0));
            const costBasis = Number(holding.cost_basis || 0);
            const institutionPrice = Number(holding.institution_price || 0);
            const livePct = costBasis > 0
              ? Number((((institutionPrice - costBasis) / costBasis) * 100).toFixed(1))
              : null;

            return {
              symbol: security.ticker_symbol || security.name || acc.subtype || 'HOLDING',
              name: security.name || holding.security_id || acc.name || 'Holding',
              value,
              weight: holdingsTotal > 0 ? Number(((value / holdingsTotal) * 100).toFixed(1)) : 0,
              livePct,
              ytdPct: null,
            };
          })
          : buildFallbackHoldingForAccount(acc);

        return {
          id: acc.account_id,
          name: acc.name,
          type: acc.type,
          subtype: acc.subtype,
          balance: acc.balances.current,
          holdings: mappedHoldings,
          ...buildLiabilityDetails(acc, liabilityByAccountId),
        };
      }),
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    const statusCode = error.message === 'Invalid JSON body' ? 400 : 500;
    return res.status(statusCode).json({
      error: statusCode === 400 ? 'Invalid request body' : 'Failed to fetch transactions',
      details: error.response?.data || error.message,
    });
  }
};
