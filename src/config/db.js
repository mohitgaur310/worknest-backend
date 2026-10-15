const mongoose = require('mongoose');

const READY_STATE_LABELS = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

function getMongoState() {
  const readyState = mongoose.connection.readyState;
  return {
    readyState,
    state: READY_STATE_LABELS[readyState] || 'unknown',
  };
}

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set. Skipping MongoDB connection.');
    return;
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log('MongoDB connected');
  } catch (error) {
    console.error(`MongoDB connection failed: ${error.message}`);
  }
}

module.exports = {
  connectDB,
  getMongoState,
};
