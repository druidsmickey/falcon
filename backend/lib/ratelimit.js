const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// Limits wrong login attempts. Successful logins are not counted.
//  - per user name and address: stops guessing one account's password
//  - per address: stops trying many user names from one place
// The address is the client address that nginx passes on (app.set('trust proxy', 1) in server.js).
function createLoginLimiters({ windowMs = 15 * 60 * 1000, perUser = 10, perAddress = 100 } = {}) {
  const common = {
    windowMs,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { message: 'Too many failed login attempts. Please try again later.' },
  };

  return [
    rateLimit({
      ...common,
      limit: perUser,
      keyGenerator: req => `${ipKeyGenerator(req.ip)}|${String(req.body?.username || '').toLowerCase()}`,
    }),
    rateLimit({
      ...common,
      limit: perAddress,
      keyGenerator: req => ipKeyGenerator(req.ip),
    }),
  ];
}

module.exports = { createLoginLimiters };
