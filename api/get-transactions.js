const { PlaidApi, PlaidEnvironments, Configuration } = require('plaid');
const { assertPlaidConfig, parseJsonBody, setCommonHeaders } = require('./_utils');
const { categorizeTransactions } = require('./_categorization');

const configuration = new Configuration({
  basePath: PlaidEnvironments.sandbox,
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});

const plaidClient = new PlaidApi(configuration);

function getPlaidErrorCode(error) {
  return error?.response?.data?.error_code || null;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createStableMetric(seed = '') {
  return seed.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function buildHoldingsForAccount(account) {
  const absoluteValue = Math.abs(Number(account?.balances?.current || 0));
  const baseSymbol = (account?.subtype || account?.type || 'account').toUpperCase().slice(0, 8);
  const metric = createStableMetric(`${account?.account_id || ''}${account?.name || ''}`);
  const livePct = Number((((metric % 25) - 12) / 10).toFixed(1));
  const ytdPct = Number((((metric % 190) - 60) / 10).toFixed(1));

  return [{
    symbol: baseSymbol,
    name: account?.name || 'Holding',
    weight: 100,
    value: absoluteValue,
    livePct,
    ytdPct,
  }];
}

function buildLiabilityDetails(account) {
  const metric = createStableMetric(`${account?.account_id || ''}${account?.subtype || ''}`);
  const isLiability = ['credit', 'loan', 'liability'].includes((account?.type || '').toLowerCase());
  if (!isLiability) return {};

  const interestRate = Number((8 + ((metric % 120) / 10)).toFixed(2));
  const termMonths = 12 + ((metric % 84));
  const now = new Date();
  const nextPaymentDate = new Date(now.getFullYear(), now.getMonth() + 1, Math.max(1, (metric % 28) + 1));
  const paymentAmount = Number((Math.max(25, Math.abs(Number(account?.balances?.current || 0)) * 0.035)).toFixed(2));

  return {
    interestRate,
    termMonths,
    nextPaymentDate: nextPaymentDate.toISOString().split('T')[0],
    paymentAmount,
  };
}


async function fetchTransactionsWithRetry(access_token, start_date, end_date) {
  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await plaidClient.transactionsGet({ access_token, start_date, end_date });
    } catch (error) {
      const plaidErrorCode = getPlaidErrorCode(error);
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
    const accounts = accountsResponse.data.accounts;

    const rawTransactions = response.data.transactions.map((tx) => {
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
      accounts: accounts.map((acc) => ({
        id: acc.account_id,
        name: acc.name,
        type: acc.type,
        subtype: acc.subtype,
        balance: acc.balances.current,
        holdings: buildHoldingsForAccount(acc),
        ...buildLiabilityDetails(acc),
      })),
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
