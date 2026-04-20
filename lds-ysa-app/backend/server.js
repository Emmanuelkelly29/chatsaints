'use strict';
require('dotenv').config();
const http = require('http');
const fs = require('fs');
const app = require('./src/app');
const { initWebSocketServer } = require('./src/websocket/wsServer');

const PORT = process.env.PORT || 4000;

// Ensure uploads directory exists
const uploadPath = process.env.LOCAL_UPLOAD_PATH || './uploads';
if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });

const server = http.createServer(app);

// Attach WebSocket server
initWebSocketServer(server);

server.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║       LDS YSA Connect — Backend          ║');
  console.log(`║  HTTP  →  http://localhost:${PORT}          ║`);
  console.log(`║  WS    →  ws://localhost:${PORT}/ws         ║`);
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
});

process.on('SIGTERM', () => { server.close(() => { console.log('Server shut down'); process.exit(0); }); });
