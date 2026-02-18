const { parseJsonBody, setCommonHeaders } = require('./_utils');
const { BUDGET_STATE_TABLE, createSupabaseAdminClient } = require('./_supabase');

function emptyPayload() {
  return {
    income: null,
    savings: null,
    budgetStartDay: null,
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

function normalizePayload(payload) {
  const fallback = emptyPayload();
  if (!payload || typeof payload !== 'object') return fallback;

  return {
    ...fallback,
    ...payload,
    fixedExpenses: Array.isArray(payload.fixedExpenses) ? payload.fixedExpenses : [],
    billingHistory: Array.isArray(payload.billingHistory) ? payload.billingHistory : [],
    accountVisibility: payload.accountVisibility && typeof payload.accountVisibility === 'object' ? payload.accountVisibility : {},
    accounts: Array.isArray(payload.accounts) ? payload.accounts : [],
    transactions: Array.isArray(payload.transactions) ? payload.transactions : [],
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
    const { data, error } = await supabase
      .from(BUDGET_STATE_TABLE)
      .select('profile_id, cycle_id, payload')
      .eq('profile_id', profileId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(200).json({ state: emptyPayload(), found: false });

    let payload = normalizePayload(data.payload);

    return res.status(200).json({
      state: payload,
      found: true,
      cycleId: cycleId || data.cycle_id || null,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load state', details: error.message || 'Unknown error' });
  }
};
