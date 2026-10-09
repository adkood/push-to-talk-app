import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { FloorManager } from './floorManager.js';

const PORT = process.env.PORT || 5000;
const server = http.createServer();
const wss = new WebSocketServer({ server });
const floorManager = new FloorManager(2500);

// Global Connected Users Registry: socket -> { userId, userName, status: 'AVAILABLE' | 'BUSY', roomId, partnerId }
const clients = new Map();

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

setInterval(() => {
  wss.clients.forEach((client) => {
    if (client.isAlive === false) return client.terminate();
    client.isAlive = false;
    client.ping();
  });
}, 30000);

server.listen(PORT, () => {
  console.log(`🚀 Server on port ${PORT}`);
});
