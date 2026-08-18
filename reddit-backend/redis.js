const { createClient } = require('redis');

let redisClient = null;
let pubClient = null;
let subClient = null;

async function connectRedis() {
  const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  console.log(`Connecting to Redis at: ${url}`);
  
  try {
    redisClient = createClient({ url });
    pubClient = createClient({ url });
    subClient = createClient({ url });

    // Handle connection error events gracefully
    redisClient.on('error', (err) => console.error('[Redis Client Error]', err.message));
    pubClient.on('error', (err) => console.error('[Redis Pub Client Error]', err.message));
    subClient.on('error', (err) => console.error('[Redis Sub Client Error]', err.message));

    await Promise.all([
      redisClient.connect(),
      pubClient.connect(),
      subClient.connect()
    ]);

    console.log('Redis clients connected successfully');
  } catch (err) {
    console.error('Failed to connect to Redis:', err.message);
    console.log('Retrying connection to Redis in 5 seconds...');
    setTimeout(connectRedis, 5000);
  }
}

// Caching Helper Functions
async function getCache(key) {
  if (!redisClient || !redisClient.isOpen) return null;
  try {
    return await redisClient.get(key);
  } catch (err) {
    console.error(`Error GET from Redis for key "${key}":`, err.message);
    return null;
  }
}

async function setCache(key, value, ttlSeconds = null) {
  if (!redisClient || !redisClient.isOpen) return null;
  try {
    const options = {};
    if (ttlSeconds) {
      options.EX = Number(ttlSeconds);
    }
    return await redisClient.set(key, String(value), options);
  } catch (err) {
    console.error(`Error SET in Redis for key "${key}":`, err.message);
    return null;
  }
}

async function delCache(key) {
  if (!redisClient || !redisClient.isOpen) return null;
  try {
    return await redisClient.del(key);
  } catch (err) {
    console.error(`Error DEL from Redis for key "${key}":`, err.message);
    return null;
  }
}

async function incrCache(key) {
  if (!redisClient || !redisClient.isOpen) return null;
  try {
    // Only increment if the key exists to avoid starting from 0 on an uninitialized cache
    const exists = await redisClient.exists(key);
    if (exists) {
      return await redisClient.incr(key);
    }
    return null;
  } catch (err) {
    console.error(`Error INCR in Redis for key "${key}":`, err.message);
    return null;
  }
}

// Pub/Sub Helper Functions
async function publishEvent(channel, message) {
  if (!pubClient || !pubClient.isOpen) {
    console.warn(`Redis Pub client is not connected. Dropping event on channel "${channel}".`);
    return null;
  }
  try {
    const payload = typeof message === 'string' ? message : JSON.stringify(message);
    return await pubClient.publish(channel, payload);
  } catch (err) {
    console.error(`Error publishing to Redis channel "${channel}":`, err.message);
    return null;
  }
}

async function subscribeToChannel(channel, callback) {
  if (!subClient || !subClient.isOpen) {
    console.log(`Postponing subscription to "${channel}" (Redis Sub client not ready yet).`);
    // Retry subscribing in 2 seconds
    setTimeout(() => subscribeToChannel(channel, callback), 2000);
    return;
  }
  try {
    await subClient.subscribe(channel, (message) => {
      try {
        const parsed = JSON.parse(message);
        callback(parsed);
      } catch {
        callback(message);
      }
    });
    console.log(`Subscribed successfully to Redis channel: "${channel}"`);
  } catch (err) {
    console.error(`Error subscribing to Redis channel "${channel}":`, err.message);
  }
}

module.exports = {
  connectRedis,
  getCache,
  setCache,
  delCache,
  incrCache,
  publishEvent,
  subscribeToChannel
};
