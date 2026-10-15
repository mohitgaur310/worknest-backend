const express = require('express');
const { User, ROLES, toPublicUser } = require('../models/user');
const { hashPassword } = require('../password');
const { requireAdmin, requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requireAdmin);

function normalizeEmail(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
}

function validateNewUser(body) {
  const name = body && typeof body.name === 'string' ? body.name.trim() : '';
  const email = normalizeEmail(body && body.email);
  const password = body && typeof body.password === 'string' ? body.password : '';
  const role = body && body.role;

  if (!name || name.length > 100) {
    return { error: 'Name is required' };
  }
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'Enter a valid email' };
  }
  if (!password) {
    return { error: 'Password is required' };
  }
  if (password.length < 8 || password.length > 128) {
    return { error: 'Password must be at least 8 characters' };
  }
  if (typeof role !== 'string' || !ROLES.includes(role)) {
    return { error: 'Role must be admin, hr, manager, or employee' };
  }

  return { name, email, password, role };
}

router.get('/', async (req, res, next) => {
  try {
    const users = await User.find({ organizationId: req.user.organizationId }).sort({
      name: 1,
      email: 1,
    });
    res.json({ users: users.map(toPublicUser) });
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  const parsed = validateNewUser(req.body);
  if (parsed.error) {
    return res.status(400).json({ error: parsed.error });
  }

  try {
    const existing = await User.findOne({ email: parsed.email }).select('_id');
    if (existing) {
      return res.status(409).json({ error: 'Email is already in use' });
    }

    const user = await User.create({
      name: parsed.name,
      email: parsed.email,
      passwordHash: await hashPassword(parsed.password),
      role: parsed.role,
      organizationId: req.user.organizationId,
      active: true,
    });

    return res.status(201).json({ user: toPublicUser(user) });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ error: 'Email is already in use' });
    }
    return next(error);
  }
});

module.exports = router;
