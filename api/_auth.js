const crypto = require('crypto');

function normalizeIdentity(value = '') {
  return String(value || '').trim().toLowerCase();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  const normalizedPassword = String(password || '');
  const normalizedStoredHash = String(storedHash || '');

  // Backward compatibility for any legacy plaintext passwords stored before hashing was added.
  if (!normalizedStoredHash.includes(':')) {
    return normalizedStoredHash.length > 0 && normalizedStoredHash === normalizedPassword;
  }

  const [salt, expected] = normalizedStoredHash.split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(normalizedPassword, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

module.exports = {
  hashPassword,
  normalizeIdentity,
  verifyPassword,
};
