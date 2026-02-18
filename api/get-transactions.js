const { assertPlaidConfig, createPlaidClient, parseJsonBody, setCommonHeaders } = require('./_utils');
const { categorizeTransactions } = require('./_categorization');

const plaidClient = createPlaidClient();

function getPlaidErrorCode(error) {
  return error?.response?.data?.error_code || null;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


function toBooleanFlag(value) {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }

  return false;
}

function buildLiabilitiesDebugPayload(liabilitiesData = {}, liabilityByAccountId = {}, accounts = []) {
  const liabilityAccounts = accounts.filter((account) => ['credit', 'loan', 'liability'].includes((account?.type || '').toLowerCase()));

  return {
    liabilityGroupCounts: {
      credit: Array.isArray(liabilitiesData.credit) ? liabilitiesData.credit.length : 0,
      student: Array.isArray(liabilitiesData.student) ? liabilitiesData.student.length : 0,
      mortgage: Array.isArray(liabilitiesData.mortgage) ? liabilitiesData.mortgage.length : 0,
    },
    mappedLiabilityByAccountId: liabilityByAccountId,
    liabilityAccounts: liabilityAccounts.map((account) => {
      const mapped = liabilityByAccountId[account.account_id] || {};
      return {
        accountId: account.account_id,
        name: account.name,
        type: account.type,
        subtype: account.subtype,
        mapped,
      };
    }),
    rawLiabilities: liabilitiesData,
  };
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
  const isLiability = ['credit', 'loan', 'liability'].includes((account?.type || '').toLowerCase());
  if (!isLiability) return {};

  const plaidLiability = liabilityByAccountId[account?.account_id] || {};
  const plaidInterestRate = Number(plaidLiability.interestRate);
  const interestRate = Number.isFinite(plaidInterestRate) ? Number(plaidInterestRate.toFixed(2)) : null;
  const termMonths = null;

  const parsedNextPaymentDate = plaidLiability.nextPaymentDate ? new Date(plaidLiability.nextPaymentDate) : null;
  const nextPaymentDate = parsedNextPaymentDate && !Number.isNaN(parsedNextPaymentDate.getTime())
    ? parsedNextPaymentDate
    : null;

  const plaidPaymentAmount = Number(plaidLiability.paymentAmount);
  const paymentAmount = Number.isFinite(plaidPaymentAmount) ? Number(plaidPaymentAmount.toFixed(2)) : null;

  const institutionName = String(account?.institutionName || '').toLowerCase();
  const accountName = String(account?.name || '').toLowerCase();
  const isFirstTechLinkedLiability = institutionName.includes('first tech') && isLiability && /line of credit|credit line|credit card|loan/.test(accountName);

  const fixedFirstTechDetails = isFirstTechLinkedLiability
    ? {
      interestRate: 2.84,
      nextPaymentDate: computeMonthlyRollingDate('2026-03-21'),
      paymentAmount: 550,
    }
    : {};

  return {
    interestRate,
    termMonths,
    nextPaymentDate: nextPaymentDate ? nextPaymentDate.toISOString().split('T')[0] : null,
    paymentAmount,
    ...fixedFirstTechDetails,
  };
}

function parseIsoDate(rawValue) {
  if (typeof rawValue !== 'string') return null;
  const trimmed = rawValue.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return trimmed;
}


function computeMonthlyRollingDate(anchorIsoDate, referenceDate = new Date()) {
  if (typeof anchorIsoDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(anchorIsoDate)) return null;

  const [year, month, day] = anchorIsoDate.split('-').map(Number);
  const ref = new Date(referenceDate);
  if (Number.isNaN(ref.getTime())) return anchorIsoDate;

  let next = new Date(year, month - 1, day);
  if (Number.isNaN(next.getTime())) return anchorIsoDate;

  while (next < ref) {
    next = new Date(next.getFullYear(), next.getMonth() + 1, day);
  }

  return next.toISOString().split('T')[0];
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
  const maxAttempts = 4;
  const unsupportedErrors = new Set([
    'INVALID_PRODUCT',
    'PRODUCTS_NOT_SUPPORTED',
    'NO_LIABILITY_ACCOUNTS',
  ]);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const liabilitiesResponse = await plaidClient.liabilitiesGet({ access_token });
      return liabilitiesResponse.data?.liabilities || {};
    } catch (error) {
      const plaidErrorCode = getPlaidErrorCode(error);
      if (unsupportedErrors.has(plaidErrorCode)) {
        return {};
      }

      const shouldRetry = plaidErrorCode === 'PRODUCT_NOT_READY';
      if (!shouldRetry || attempt === maxAttempts) {
        throw error;
      }

      await wait(attempt * 600);
    }
  }

  return {};
}

function buildLiabilityByAccountId(liabilities = {}) {
  const liabilityByAccountId = {};

  const getEntryValue = (entry, ...keys) => {
    for (const key of keys) {
      if (!key) continue;
      const value = entry?.[key];
      if (value !== undefined && value !== null && value !== '') return value;
    }

    return undefined;
  };

  const readNumber = (...values) => {
    for (const value of values) {
      if (value === null || value === undefined) continue;

      const normalizedValue = typeof value === 'string'
        ? value.replace(/[$,%\s,]/g, '')
        : value;

      if (typeof normalizedValue === 'string' && normalizedValue.trim() === '') continue;

      const parsed = Number(normalizedValue);
      if (Number.isFinite(parsed)) return parsed;
    }

    return undefined;
  };

  const readDate = (...values) => {
    for (const value of values) {
      if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().split('T')[0];
      }

      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (!trimmed) continue;
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

      const parsed = new Date(trimmed);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString().split('T')[0];
      }
    }

    return undefined;
  };

  const upsertLiabilityDetails = (accountId, details) => {
    if (!accountId) return;

    const existing = liabilityByAccountId[accountId] || {};
    liabilityByAccountId[accountId] = {
      ...existing,
      ...Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined && value !== null && value !== '')),
    };
  };

  (liabilities.credit || []).forEach((entry) => {
    const aprs = Array.isArray(getEntryValue(entry, 'aprs')) ? getEntryValue(entry, 'aprs') : [];
    const purchaseApr = aprs.find((aprEntry) => String(getEntryValue(aprEntry, 'apr_type', 'aprType') || '').toLowerCase() === 'purchase_apr');
    const apr = readNumber(
      getEntryValue(purchaseApr, 'apr_percentage', 'aprPercentage'),
      getEntryValue(aprs[0], 'apr_percentage', 'aprPercentage'),
      getEntryValue(entry, 'interest_rate_percentage', 'interestRatePercentage'),
      getEntryValue(getEntryValue(entry, 'interest_rate', 'interestRate') || {}, 'percentage'),
    );
    const paymentAmount = readNumber(
      getEntryValue(entry, 'minimum_payment_amount', 'minimumPaymentAmount'),
      getEntryValue(entry, 'next_payment_amount', 'nextPaymentAmount'),
      getEntryValue(entry, 'last_payment_amount', 'lastPaymentAmount'),
    );

    upsertLiabilityDetails(getEntryValue(entry, 'account_id', 'accountId'), {
      interestRate: Number.isFinite(apr) ? Number(apr.toFixed(2)) : undefined,
      nextPaymentDate: readDate(
        getEntryValue(entry, 'next_payment_due_date', 'nextPaymentDueDate'),
        getEntryValue(entry, 'next_payment_date', 'nextPaymentDate'),
      ),
      paymentAmount: Number.isFinite(paymentAmount) ? Number(paymentAmount.toFixed(2)) : undefined,
    });
  });

  (liabilities.student || []).forEach((entry) => {
    const loans = Array.isArray(getEntryValue(entry, 'loans')) && getEntryValue(entry, 'loans').length
      ? getEntryValue(entry, 'loans')
      : [entry];

    loans.forEach((loan) => {
      const apr = readNumber(
        getEntryValue(loan, 'interest_rate_percentage', 'interestRatePercentage'),
        getEntryValue(getEntryValue(loan, 'interest_rate', 'interestRate') || {}, 'percentage'),
        getEntryValue(entry, 'interest_rate_percentage', 'interestRatePercentage'),
        getEntryValue(getEntryValue(entry, 'interest_rate', 'interestRate') || {}, 'percentage'),
      );
      const paymentAmount = readNumber(
        getEntryValue(loan, 'minimum_payment_amount', 'minimumPaymentAmount'),
        getEntryValue(loan, 'next_payment_amount', 'nextPaymentAmount'),
        getEntryValue(loan, 'last_payment_amount', 'lastPaymentAmount'),
        getEntryValue(entry, 'minimum_payment_amount', 'minimumPaymentAmount'),
        getEntryValue(entry, 'next_payment_amount', 'nextPaymentAmount'),
        getEntryValue(entry, 'last_payment_amount', 'lastPaymentAmount'),
      );

      upsertLiabilityDetails(
        getEntryValue(loan, 'account_id', 'accountId') || getEntryValue(entry, 'account_id', 'accountId'),
        {
          interestRate: Number.isFinite(apr) ? Number(apr.toFixed(2)) : undefined,
          nextPaymentDate: readDate(
            getEntryValue(loan, 'next_payment_due_date', 'nextPaymentDueDate'),
            getEntryValue(loan, 'next_payment_date', 'nextPaymentDate'),
            getEntryValue(entry, 'next_payment_due_date', 'nextPaymentDueDate'),
            getEntryValue(entry, 'next_payment_date', 'nextPaymentDate'),
          ),
          paymentAmount: Number.isFinite(paymentAmount) ? Number(paymentAmount.toFixed(2)) : undefined,
        },
      );
    });
  });

  (liabilities.mortgage || []).forEach((entry) => {
    const apr = readNumber(
      getEntryValue(getEntryValue(entry, 'interest_rate', 'interestRate') || {}, 'percentage'),
      getEntryValue(entry, 'interest_rate_percentage', 'interestRatePercentage'),
    );
    const paymentAmount = readNumber(
      getEntryValue(entry, 'next_monthly_payment', 'nextMonthlyPayment'),
      getEntryValue(entry, 'next_payment_amount', 'nextPaymentAmount'),
      getEntryValue(entry, 'minimum_payment_amount', 'minimumPaymentAmount'),
      getEntryValue(entry, 'last_payment_amount', 'lastPaymentAmount'),
    );

    upsertLiabilityDetails(getEntryValue(entry, 'account_id', 'accountId'), {
      interestRate: Number.isFinite(apr) ? Number(apr.toFixed(2)) : undefined,
      nextPaymentDate: readDate(
        getEntryValue(entry, 'next_payment_due_date', 'nextPaymentDueDate'),
        getEntryValue(entry, 'next_payment_date', 'nextPaymentDate'),
      ),
      paymentAmount: Number.isFinite(paymentAmount) ? Number(paymentAmount.toFixed(2)) : undefined,
    });
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

    const requestBody = parseJsonBody(req);
    const access_token = requestBody?.access_token;
    const debugLiabilities = toBooleanFlag(requestBody?.debugLiabilities) || toBooleanFlag(req?.query?.debugLiabilities);

    if (!access_token) {
      return res.status(400).json({ error: 'access_token is required' });
    }

    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const requestedStartDate = parseIsoDate(requestBody?.start_date);
    const requestedEndDate = parseIsoDate(requestBody?.end_date);

    const start_date = requestedStartDate || ninetyDaysAgo.toISOString().split('T')[0];
    const end_date = requestedEndDate || now.toISOString().split('T')[0];

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
    const postedPendingReferences = new Set(
      sourceTransactions
        .filter((tx) => !tx.pending && tx.pending_transaction_id)
        .map((tx) => tx.pending_transaction_id),
    );
    const filteredTransactions = sourceTransactions.filter((tx) => !(tx.pending && postedPendingReferences.has(tx.transaction_id)));

    const rawTransactions = filteredTransactions.map((tx) => {
      const account = accounts.find((acc) => acc.account_id === tx.account_id);
      const accountType = account?.type === 'credit' ? 'credit' : 'checking';
      const normalizedAmount = -tx.amount;

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

    const responsePayload = {
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
          institutionName: acc?.official_name || acc?.institution_name || null,
          balance: acc.balances.current,
          holdings: mappedHoldings,
          ...buildLiabilityDetails(acc, liabilityByAccountId),
        };
      }),
    };

    if (debugLiabilities) {
      responsePayload.liabilitiesDebug = buildLiabilitiesDebugPayload(liabilitiesData, liabilityByAccountId, accounts);
    }

    return res.status(200).json(responsePayload);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    const statusCode = error.message === 'Invalid JSON body' ? 400 : 500;
    return res.status(statusCode).json({
      error: statusCode === 400 ? 'Invalid request body' : 'Failed to fetch transactions',
      details: error.response?.data || error.message,
    });
  }
};
