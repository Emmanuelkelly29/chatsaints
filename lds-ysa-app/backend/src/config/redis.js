const redis = require('redis');

let client;

const getRedisClient = async () => {
  if (client && client.isOpen) return client;

  client = redis.createClient({
    socket: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
    },
    password: process.env.REDIS_PASSWORD || undefined,
  });

  client.on('error', (err) => console.error('Redis error:', err.message));
  client.on('connect', () => console.log('Redis connected'));

  await client.connect();
  return client;
};

// Key helpers
const keys = {
  userOnline: (userId) => `online:${userId}`,
  userSession: (userId) => `session:${userId}`,
  pinnedChats: (userId) => `pinned:${userId}`,
  scriptureCurrent: () => 'scripture:current',
  missionaryLock: (userId) => `missionary_lock:${userId}`,
  rateLimit: (ip) => `rate:${ip}`,
};

module.exports = { getRedisClient, keys };
