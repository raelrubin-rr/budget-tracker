const { parseJsonBody, setCommonHeaders } = require('./_utils');
const { BUDGET_STATE_TABLE, createSupabaseAdminClient } = require('./_supabase');

function sanitizeState(payload) {
  if (!payload || typeof payload !== 'object') {
    return {
      income: 0,
      savings: 0,
      budgetStartDay: 4,
      fixedExpenses: [],
      billingHistory: [],
      accountVisibility: {},
      accounts: [],
      transactions: [],
      lastAccountsUpdatedAt: null,
      accountOverrides: {},
      transactionOverrides: {},
      customAssets: [],
      plaidItems: [],
    };
  }

  return {
    income: Number(payload.income || 0),
    savings: Number(payload.savings || 0),
    budgetStartDay: Number(payload.budgetStartDay || 4),
    fixedExpenses: Array.isArray(payload.fixedExpenses) ? payload.fixedExpenses : [],
    billingHistory: Array.isArray(payload.billingHistory) ? payload.billingHistory : [],
    accountVisibility: payload.accountVisibility && typeof payload.accountVisibility === 'object' ? payload.accountVisibility : {},
    accounts: Array.isArray(payload.accounts) ? payload.accounts : [],
    transactions: Array.isArray(payload.transactions) ? payload.transactions : [],
    lastAccountsUpdatedAt: payload.lastAccountsUpdatedAt || null,
    accountOverrides: payload.accountOverrides && typeof payload.accountOverrides === 'object' ? payload.accountOverrides : {},
    transactionOverrides: payload.transactionOverrides && typeof payload.transactionOverrides === 'object' ? payload.transactionOverrides : {},
    customAssets: Array.isArray(payload.customAssets) ? payload.customAssets : [],
    plaidItems: Array.isArray(payload.plaidItems) ? payload.plaidItems : [],
  };
}

module.exports = async (req, res) => {
  setCommonHeaders(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const requestBody = parseJsonBody(req);
    const profileId = String(requestBody?.profileId || '').trim();
    const cycleId = String(requestBody?.cycleId || '').trim();

    if (!profileId) return res.status(400).json({ error: 'profileId is required' });

    const supabase = createSupabaseAdminClient();
    const payload = sanitizeState(requestBody?.state || {});

    const { error } = await supabase.from(BUDGET_STATE_TABLE).upsert({
      profile_id: profileId,
      cycle_id: cycleId || null,
      payload,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'profile_id' });

    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to save state', details: error.message || 'Unknown error' });
  }
};
