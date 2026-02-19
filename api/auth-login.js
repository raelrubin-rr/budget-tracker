const { parseJsonBody, setCommonHeaders } = require('./_utils');
const { APP_USERS_TABLE, createSupabaseAdminClient } = require('./_supabase');
const { normalizeIdentity, verifyPassword } = require('./_auth');

module.exports = async (req, res) => {
  setCommonHeaders(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = parseJsonBody(req);
    const usernameOrEmail = normalizeIdentity(body?.username);
    const password = String(body?.password || '');

    if (!usernameOrEmail || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }

    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from(APP_USERS_TABLE)
      .select('id, username, email, name, phone, password_hash')
      .or(`username.eq.${usernameOrEmail},email.eq.${usernameOrEmail}`)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data || !verifyPassword(password, data.password_hash)) {
      return res.status(401).json({ error: 'Invalid username/email or password' });
    }

    return res.status(200).json({
      ok: true,
      user: {
        id: data.id,
        username: data.username,
        email: data.email,
        name: data.name,
        phone: data.phone,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to sign in', details: error.message || 'Unknown error' });
  }
};
