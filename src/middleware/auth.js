const mongoose = require('mongoose');
const { User } = require('../models/user');
const { clearSessionCookie, destroySession } = require('../session');

async function requireAuth(req, res, next) {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'Database is unavailable' });
    }

    const userId = req.session && req.session.userId;
    if (!userId || !mongoose.isValidObjectId(userId)) {
      return res.status(401).json({ error: 'Sign in required' });
    }

    const user = await User.findById(userId);
    if (!user || !user.active) {
      await destroySession(req);
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Sign in required' });
    }

    req.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  return next();
}

module.exports = {
  requireAuth,
  requireAdmin,
};
