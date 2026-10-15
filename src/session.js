const session = require('express-session');
const { MongoStore } = require('connect-mongo');

const COOKIE_NAME = 'worknest.sid';

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: false,
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

function createSessionMiddleware(client, dbName) {
  const secret = process.env.SESSION_SECRET || 'worknest-local-dev-secret';
  if (!process.env.SESSION_SECRET) {
    console.warn('SESSION_SECRET is not set. Using the local development default.');
  }

  return session({
    name: COOKIE_NAME,
    secret,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      client,
      dbName,
    }),
    cookie: cookieOptions,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: cookieOptions.httpOnly,
    sameSite: cookieOptions.sameSite,
    secure: cookieOptions.secure,
    path: cookieOptions.path,
  });
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function destroySession(req) {
  return new Promise((resolve) => {
    if (!req.session) {
      resolve();
      return;
    }
    req.session.destroy(() => resolve());
  });
}

module.exports = {
  COOKIE_NAME,
  createSessionMiddleware,
  clearSessionCookie,
  regenerateSession,
  saveSession,
  destroySession,
};
