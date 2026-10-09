import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { FloorManager } from './floorManager.js';

try {
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile();
  }
} catch {
  // .env is optional; production environments supply variables via process.env
}

const PORT = Number(process.env.PORT) || 5000;
const HOST = process.env.HOST || '0.0.0.0';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Look for client build directory if available
const candidateDistPaths = [
  path.resolve(__dirname, '../../client/dist'),
  path.resolve(process.cwd(), 'client/dist'),
  path.resolve(process.cwd(), '../client/dist'),
];
const clientDistPath = candidateDistPaths.find((dir) => {
  try {
    return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}) || null;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

// Global Connected Users Registry: socket -> { userId, userName, status: 'AVAILABLE' | 'BUSY', roomId, partnerId }
const clients = new Map();

const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let pathname = '/';
  try {
    const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    pathname = (req.url || '/').split('?')[0];
  }

  // Health check endpoint (Render ping / uptime monitor)
  if (pathname === '/health' || pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'push-to-talk-server',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      connectedClients: clients.size,
    }));
    return;
  }

  // If built client assets exist, serve static frontend
  if (clientDistPath) {
    let filePath = path.join(clientDistPath, pathname);

    // Prevent directory traversal attacks
    if (filePath.startsWith(clientDistPath)) {
      try {
        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
          filePath = path.join(filePath, 'index.html');
        }

        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const ext = path.extname(filePath).toLowerCase();
          const contentType = MIME_TYPES[ext] || 'application/octet-stream';
          res.writeHead(200, {
            'Content-Type': contentType,
            ...(ext === '.html' ? { 'Cache-Control': 'no-cache' } : { 'Cache-Control': 'public, max-age=31536000, immutable' }),
          });
          fs.createReadStream(filePath).pipe(res);
          return;
        }
      } catch {
        // Fall back to index.html for SPA routes
      }
    }

    const indexPath = path.join(clientDistPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(indexPath).pipe(res);
      return;
    }
  }

  // Standalone server response when client is not bundled
  if (pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'push-to-talk-server',
      message: 'Push-To-Talk WebSocket server is running.',
      websocketPath: '/ws',
      uptime: Math.floor(process.uptime()),
      connectedClients: clients.size,
    }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

const wss = new WebSocketServer({ server });
const floorManager = new FloorManager(2500);

function sendJson(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcastUserList() {
  const users = [];
  for (const info of clients.values()) {
    users.push({ userId: info.userId, userName: info.userName, status: info.status });
  }
  const payload = JSON.stringify({ type: 'USER_LIST', payload: { users } });
  for (const ws of clients.keys()) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

function findSocketByUserId(userId) {
  for (const [ws, info] of clients.entries()) {
    if (info.userId === userId) return ws;
  }
  return null;
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    try {
      const { type, payload } = JSON.parse(raw);

      switch (type) {
        case 'REGISTER': {
          clients.set(ws, {
            userId: payload.userId,
            userName: payload.userName,
            status: 'AVAILABLE',
            roomId: null,
            partnerId: null,
          });
          sendJson(ws, { type: 'REGISTER_OK', payload: { userId: payload.userId, userName: payload.userName } });
          broadcastUserList();
          break;
        }

        case 'START_CALL': {
          const sender = clients.get(ws);
          if (!sender) return;

          const targetWs = findSocketByUserId(payload.targetUserId);
          const target = targetWs ? clients.get(targetWs) : null;

          if (!targetWs || !target) {
            sendJson(ws, { type: 'CALL_ERROR', payload: { message: 'User is no longer online.' } });
            return;
          }

          if (target.status === 'BUSY') {
            sendJson(ws, {
              type: 'CALL_ERROR',
              payload: { message: `${target.userName} is currently in a conversation with someone else.` },
            });
            return;
          }

          const roomId = `call_${[sender.userId, target.userId].sort().join('_')}`;
          sender.status = 'BUSY';
          sender.roomId = roomId;
          sender.partnerId = target.userId;

          target.status = 'BUSY';
          target.roomId = roomId;
          target.partnerId = sender.userId;

          sendJson(ws, {
            type: 'CALL_CONNECTED',
            payload: { roomId, partner: { userId: target.userId, userName: target.userName }, isInitiator: true },
          });

          sendJson(targetWs, {
            type: 'CALL_CONNECTED',
            payload: { roomId, partner: { userId: sender.userId, userName: sender.userName }, isInitiator: false },
          });

          broadcastUserList();
          break;
        }

        case 'LEAVE_CALL': {
          const sender = clients.get(ws);
          if (!sender || !sender.roomId) return;

          const partnerWs = findSocketByUserId(sender.partnerId);
          const partner = partnerWs ? clients.get(partnerWs) : null;

          floorManager.clearFloor(sender.roomId);

          sender.status = 'AVAILABLE';
          sender.roomId = null;
          sender.partnerId = null;
          sendJson(ws, { type: 'CALL_ENDED' });

          if (partnerWs && partner) {
            partner.status = 'AVAILABLE';
            partner.roomId = null;
            partner.partnerId = null;
            sendJson(partnerWs, { type: 'CALL_ENDED', payload: { reason: `${sender.userName} ended the call.` } });
          }

          broadcastUserList();
          break;
        }

        case 'RTC_SIGNAL': {
          const sender = clients.get(ws);
          if (!sender || !sender.partnerId) return;

          const targetWs = findSocketByUserId(payload.targetUserId);
          if (targetWs) {
            sendJson(targetWs, {
              type: 'RTC_SIGNAL',
              payload: { fromUserId: sender.userId, signal: payload.signal },
            });
          }
          break;
        }

        case 'ACQUIRE_FLOOR': {
          const sender = clients.get(ws);
          if (!sender || !sender.roomId) return;

          const partnerWs = findSocketByUserId(sender.partnerId);
          const result = floorManager.acquireFloor(sender.roomId, { userId: sender.userId, userName: sender.userName }, () => {
            sendJson(ws, { type: 'FLOOR_RELEASED' });
            if (partnerWs) sendJson(partnerWs, { type: 'FLOOR_RELEASED' });
          });

          if (result.success) {
            sendJson(ws, { type: 'FLOOR_GRANTED' });
            if (partnerWs) sendJson(partnerWs, { type: 'FLOOR_TAKEN' });
          } else {
            sendJson(ws, { type: 'FLOOR_DENIED' });
          }
          break;
        }

        case 'HEARTBEAT': {
          const sender = clients.get(ws);
          if (!sender || !sender.roomId) return;
          if (!floorManager.heartbeat(sender.roomId, sender.userId)) {
            sendJson(ws, { type: 'FLOOR_LOST' });
          }
          break;
        }

        case 'RELEASE_FLOOR': {
          const sender = clients.get(ws);
          if (!sender || !sender.roomId) return;

          const partnerWs = findSocketByUserId(sender.partnerId);
          if (floorManager.releaseFloor(sender.roomId, sender.userId)) {
            sendJson(ws, { type: 'FLOOR_RELEASED' });
            if (partnerWs) sendJson(partnerWs, { type: 'FLOOR_RELEASED' });
          }
          break;
        }
      }
    } catch (err) {
      // Ignored
    }
  });

  ws.on('close', () => {
    const info = clients.get(ws);
    if (!info) return;

    if (info.roomId && info.partnerId) {
      floorManager.clearFloor(info.roomId);
      const partnerWs = findSocketByUserId(info.partnerId);
      if (partnerWs) {
        const partner = clients.get(partnerWs);
        if (partner) {
          partner.status = 'AVAILABLE';
          partner.roomId = null;
          partner.partnerId = null;
          sendJson(partnerWs, { type: 'CALL_ENDED', payload: { reason: `${info.userName} disconnected.` } });
        }
      }
    }

    clients.delete(ws);
    broadcastUserList();
  });
});

const pingInterval = setInterval(() => {
  wss.clients.forEach((client) => {
    if (client.isAlive === false) return client.terminate();
    client.isAlive = false;
    try {
      client.ping();
    } catch {
      client.terminate();
    }
  });
}, 30000);

server.listen(PORT, HOST, () => {
  console.log(`🚀 Server listening on http://${HOST}:${PORT}`);
  console.log(`📡 WebSocket ready on ws://${HOST}:${PORT}`);
  if (clientDistPath) {
    console.log(`📦 Serving client build from: ${clientDistPath}`);
  }
});

const gracefulShutdown = (signal) => {
  console.log(`\n🛑 Received ${signal}. Shutting down server gracefully...`);
  clearInterval(pingInterval);

  wss.clients.forEach((client) => {
    try {
      client.close(1001, 'Server is shutting down');
    } catch {
      // Ignored
    }
  });

  wss.close(() => {
    server.close(() => {
      console.log('✅ Server and WebSockets closed cleanly.');
      process.exit(0);
    });
  });

  setTimeout(() => {
    console.error('⚠️ Forcefully terminating after shutdown timeout.');
    process.exit(1);
  }, 5000).unref();
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

