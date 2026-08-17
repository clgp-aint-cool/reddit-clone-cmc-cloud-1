const mongoose = require('mongoose');

async function connectMongo() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/reddit_notifications';
  console.log(`Connecting to MongoDB at: ${uri}`);
  try {
    await mongoose.connect(uri);
    console.log('MongoDB connected successfully');
  } catch (err) {
    console.error('Failed to connect to MongoDB:', err.message);
    console.log('Retrying connection to MongoDB in 5 seconds...');
    setTimeout(connectMongo, 5000);
  }
}

module.exports = { connectMongo };
