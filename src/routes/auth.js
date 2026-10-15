const express = require('express');
const mongoose = require('mongoose');
const { User, toPublicUser } = require('../models/user');
const { passwordMatches } = require('../password');
const { requireAuth } = require('../middleware/auth');
const {
  clearSessionCookie,
  destroySession,
  regenerateSession,
  saveSession,
} = require('../session');

const router = express.Router();

const SAFE_LOGIN_ERROR = 'Invalid email or password';

function normalizeEmail(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
}

router.post('/login', async (req, res) => {
  if (mongoose.connection.readyState !== 1 || !req.session) {
    return res.status(503).json({ error: 'Sign-in is unavailable' });
  }

  const email = normalizeEmail(req.body && req.body.email);
  const password = req.body && typeof req.body.password === 'string' ? req.body.password : '';
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const user = await User.findOne({ email }).select('+passwordHash');
    const matches = await passwordMatches(password, user && user.passwordHash);
    // Unknown accounts, wrong passwords, and inactive users share one response.
    if (!user || !matches || !user.active) {
      return res.status(401).json({ error: SAFE_LOGIN_ERROR });
    }

    await regenerateSession(req);
    req.session.userId = user._id.toString();
    await saveSession(req);
    return res.json({ user: toPublicUser(user) });
  } catch (error) {
    console.error(`Sign-in failed: ${error.message}`);
    return res.status(503).json({ error: 'Sign-in is unavailable' });
  }
});

router.post('/logout', async (req, res) => {
  await destroySession(req);
  clearSessionCookie(res);
  return res.status(204).end();
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: toPublicUser(req.user) });
});

module.exports = router;
