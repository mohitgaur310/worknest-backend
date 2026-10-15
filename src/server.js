require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { connectDB, getMongoState } = require('./config/db');

const app = express();
const port = Number(process.env.PORT) || 4000;

app.use(cors());
app.use(express.json());

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

app.listen(port, () => {
  console.log(`Worknest API listening on http://localhost:${port}`);
});

connectDB();
