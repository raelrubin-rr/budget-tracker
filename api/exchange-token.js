const { assertPlaidConfig, createPlaidClient, parseJsonBody, setCommonHeaders } = require('./_utils');

const plaidClient = createPlaidClient();

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

    const { public_token } = parseJsonBody(req);

    if (!public_token) {
      return res.status(400).json({ error: 'public_token is required' });
    }

    const response = await plaidClient.itemPublicTokenExchange({ public_token });

    return res.status(200).json({
      access_token: response.data.access_token,
      item_id: response.data.item_id,
    });
  } catch (error) {
    console.error('Error exchanging token:', error);
    const statusCode = error.message === 'Invalid JSON body' ? 400 : 500;
    return res.status(statusCode).json({
      error: statusCode === 400 ? 'Invalid request body' : 'Failed to exchange token',
      details: error.response?.data || error.message,
    });
  }
};
