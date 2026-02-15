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

    const response = await plaidClient.transactionsGet({
      access_token,
      start_date: ninetyDaysAgo.toISOString().split('T')[0],
      end_date: now.toISOString().split('T')[0],
    });
    const accountsResponse = await plaidClient.accountsGet({ access_token });
    const accounts = accountsResponse.data.accounts;

    const rawTransactions = response.data.transactions.map((tx) => {
      const account = accounts.find((acc) => acc.account_id === tx.account_id);
      const accountType = account?.type === 'credit' ? 'credit' : 'checking';

      return {
        id: tx.transaction_id,
        name: tx.name,
        amount: accountType === 'credit' ? -Math.abs(tx.amount) : tx.amount,
        date: tx.date,
        pending: tx.pending,
        account: accountType,
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
