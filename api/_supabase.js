const { createClient } = require('@supabase/supabase-js');

const BUDGET_STATE_TABLE = 'budget_states';
const APP_USERS_TABLE = 'app_users';

function assertSupabaseConfig() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
  }
}

function createSupabaseAdminClient() {
  assertSupabaseConfig();
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

module.exports = {
  APP_USERS_TABLE,
  BUDGET_STATE_TABLE,
  assertSupabaseConfig,
  createSupabaseAdminClient,
};
