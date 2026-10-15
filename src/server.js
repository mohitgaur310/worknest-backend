require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { connectDB, getMongoState } = require('./config/db');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const projectRoutes = require('./routes/projects');
const taskRoutes = require('./routes/tasks');
const { seedIfEmpty } = require('./seed');
const { createSessionMiddleware } = require('./session');

const app = express();
const port = Number(process.env.PORT) || 4000;

const allowedOrigins = new Set([
  process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

let sessionHandler = (req, _res, next) => {
  req.session = null;
  next();
};

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  }),
);
app.use(express.json());
app.use((req, res, next) => sessionHandler(req, res, next));

app.get('/health', (_req, res) => {
  const mongo = getMongoState();

  res.status(200).json({
    status: 'ok',
    process: {
      status: 'running',
      pid: process.pid,
      uptimeSeconds: Number(process.uptime().toFixed(1)),
      node: process.version,
    },
    mongo,
  });
});

app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/projects', projectRoutes);
app.use('/tasks', taskRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, _req, res, _next) => {
  if (err instanceof SyntaxError && err.status === 400) {
    res.status(400).json({ error: 'Request body must be JSON' });
    return;
  }
  console.error(err);
  if (res.headersSent) {
    return;
  }
  res.status(500).json({ error: 'Something went wrong' });
});

function enableSessions() {
  sessionHandler = createSessionMiddleware(
    mongoose.connection.getClient(),
    mongoose.connection.name,
  );
  console.log('Session store ready');
}

async function start() {
  const connected = await connectDB();
  if (connected) {
    enableSessions();
    try {
      await seedIfEmpty();
    } catch (error) {
      console.error(`Startup seed failed: ${error.message}`);
    }
  }

  app.listen(port, () => {
    console.log(`Worknest API listening on http://localhost:${port}`);
  });
}

start();
