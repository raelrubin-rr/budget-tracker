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
    const { redirect_uri } = parseJsonBody(req);
    const configuredRedirectUri = process.env.PLAID_REDIRECT_URI || null;
    const requestRedirectUri = typeof redirect_uri === 'string' && redirect_uri.trim() ? redirect_uri.trim() : null;

    const request = {
      user: {
        client_user_id: 'user-' + Date.now(),
      },
      client_name: 'Raelyboy',
      products: ['transactions', 'liabilities', 'investments'],
      country_codes: ['US'],
      language: 'en',
    };

    const finalRedirectUri = configuredRedirectUri || requestRedirectUri;
    if (finalRedirectUri) {
      request.redirect_uri = finalRedirectUri;
    }

    const response = await plaidClient.linkTokenCreate(request);

    return res.status(200).json({
      link_token: response.data.link_token,
      expiration: response.data.expiration,
    });
  } catch (error) {
    console.error('Error creating link token:', error);
    const plaidDetails = error.response?.data;
    const detailMessage =
      plaidDetails?.error_message ||
      plaidDetails?.display_message ||
      plaidDetails?.error_code ||
      error.message;

    const environmentLabel = process.env.PLAID_ENV || 'sandbox';

    return res.status(500).json({
      error: 'Failed to create link token',
      details: plaidDetails || error.message,
      message: detailMessage,
      plaid_environment: environmentLabel,
      help: 'Verify PLAID_CLIENT_ID and PLAID_SECRET are from the same Plaid environment configured in PLAID_ENV.',
    });
  }
};
