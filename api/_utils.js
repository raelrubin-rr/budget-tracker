function setCommonHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function parseJsonBody(req) {
  if (!req || req.body == null) {
    return {};
  }

  if (typeof req.body === 'string') {
    if (!req.body.trim()) {
      return {};
    }

    try {
      return JSON.parse(req.body);
    } catch (error) {
      throw new Error('Invalid JSON body');
    }
  }

  if (typeof req.body === 'object') {
    return req.body;
  }

  return {};
}

function assertPlaidConfig() {
  if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
    throw new Error('Missing PLAID_CLIENT_ID or PLAID_SECRET environment variables');
  }
}

module.exports = {
  assertPlaidConfig,
  parseJsonBody,
  setCommonHeaders,
};
