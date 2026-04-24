'use strict';
require('dotenv').config();
const http = require('http');
const app = require('./app');
const { initWebSocketServer } = require('./websocket/wsServer');
const { pool } = require('./config/database');
const { getRedisClient } = require('./config/redis');

const PORT = parseInt(process.env.PORT) || 4000;

const server = http.createServer(app);

// Attach WebSocket server
initWebSocketServer(server);

const start = async () => {
  try {
    // Test DB connection
    await pool.query('SELECT NOW()');
    console.log('[DB] PostgreSQL connected');

    // Test Redis connection
    await getRedisClient();
    console.log('[Redis] Connected');

    server.listen(PORT, () => {
      console.log(`\n========================================`);
      console.log(`  ChatSaints API`);
      console.log(`  HTTP  : http://localhost:${PORT}`);
      console.log(`  WS    : ws://localhost:${PORT}/ws`);
      console.log(`  Health: http://localhost:${PORT}/health`);
      console.log(`========================================\n`);
    });
  } catch (err) {
    console.error('[STARTUP ERROR]', err.message);
    console.error('Make sure PostgreSQL and Redis are running.');
    process.exit(1);
  }
};

process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  server.close(() => { pool.end(); process.exit(0); });
});

start();
