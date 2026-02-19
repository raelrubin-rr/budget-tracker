const { parseJsonBody, setCommonHeaders } = require('./_utils');
const { APP_USERS_TABLE, createSupabaseAdminClient } = require('./_supabase');
const { hashPassword, normalizeIdentity } = require('./_auth');

module.exports = async (req, res) => {
  setCommonHeaders(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = parseJsonBody(req);
    const username = normalizeIdentity(body?.username);
    const email = normalizeIdentity(body?.email);
    const name = String(body?.name || '').trim();
    const phone = String(body?.phone || '').trim();
    const password = String(body?.password || '');

    if (!username || !email || !name || !phone || password.length < 8) {
      return res.status(400).json({ error: 'username, email, name, phone, and password (min 8 chars) are required' });
    }

    const supabase = createSupabaseAdminClient();
    const { data: existing, error: existingError } = await supabase
      .from(APP_USERS_TABLE)
      .select('id')
      .or(`username.eq.${username},email.eq.${email}`)
      .limit(1)
      .maybeSingle();

    if (existingError) throw existingError;
    if (existing) return res.status(409).json({ error: 'Username or email already in use' });

    const passwordHash = hashPassword(password);
    const { data, error } = await supabase
      .from(APP_USERS_TABLE)
      .insert({ username, email, name, phone, password_hash: passwordHash })
      .select('id, username, email, name, phone')
      .single();

    if (error) throw error;

    return res.status(200).json({
      ok: true,
      user: data,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create account', details: error.message || 'Unknown error' });
  }
};
