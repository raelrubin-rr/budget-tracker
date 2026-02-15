// Serverless function to fetch transactions from Plaid
const { PlaidApi, PlaidEnvironments, Configuration } = require('plaid');

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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { access_token } = req.body;
    
    if (!access_token) {
      return res.status(400).json({ error: 'access_token is required' });
    }

    // Get transactions from last 90 days
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    
    const request = {
      access_token,
      start_date: ninetyDaysAgo.toISOString().split('T')[0],
      end_date: now.toISOString().split('T')[0],
    };

    const response = await plaidClient.transactionsGet(request);
    
    // Get accounts to determine checking vs credit
    const accountsResponse = await plaidClient.accountsGet({ access_token });
    const accounts = accountsResponse.data.accounts;

    // Map transactions with account type
    const transactions = response.data.transactions.map(tx => {
      const account = accounts.find(acc => acc.account_id === tx.account_id);
      const accountType = account?.type === 'credit' ? 'credit' : 'checking';
      
      return {
        id: tx.transaction_id,
        name: tx.name,
        amount: accountType === 'credit' ? -Math.abs(tx.amount) : tx.amount,
        date: tx.date,
        pending: tx.pending,
        account: accountType,
        category: tx.category ? tx.category[0].toLowerCase() : 'other',
        reimbursable: 0,
        linkedDeposit: null,
      };
    });

    res.status(200).json({
      transactions,
      accounts: accounts.map(acc => ({
        id: acc.account_id,
        name: acc.name,
        type: acc.type,
        subtype: acc.subtype,
        balance: acc.balances.current,
      })),
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({
      error: 'Failed to fetch transactions',
      details: error.response?.data || error.message,
    });
  }
};
