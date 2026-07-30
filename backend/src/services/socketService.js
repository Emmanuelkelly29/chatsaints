/**
 * WebSocket Service — handles real-time messaging, typing, presence
 */
const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const { canChat } = require('../utils/hierarchy');

// Track online users: userId -> Set of socket IDs
const onlineUsers = new Map();

function setupSocketHandlers(io) {
  // ── Auth middleware for sockets ──────────────
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('No token'));
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
      const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
      if (!user || user.accountStatus === 'SUSPENDED') return next(new Error('Unauthorized'));
      socket.userId = user.id;
      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Auth failed'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.userId;
    console.log(`Socket connected: ${userId}`);

    // Track online status
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);

    // Join all user's conversation rooms
    joinUserRooms(socket);

    // Broadcast online status
    socket.broadcast.emit('user:online', { userId });

    // ── Send message ──────────────────────────
    socket.on('message:send', async (data) => {
      try {
        const { conversationId, content, type = 'TEXT', mediaUrl, fileName,
                fileSize, duration, replyToId } = data;

        // Verify sender is in conversation
        const participant = await prisma.conversationParticipant.findUnique({
          where: { conversationId_userId: { conversationId, userId } }
        });
        if (!participant) return socket.emit('error', { message: 'Not in conversation' });

        const message = await prisma.message.create({
          data: {
            conversationId, senderId: userId,
            type, content, mediaUrl, fileName, fileSize, duration, replyToId
          },
          include: {
            sender: { select: { id:1, firstName:1, lastName:1, profilePhoto:1 } },
            replyTo: { include: { sender: { select: { id:1, firstName:1 } } } }
          }
        });

        // Update conversation timestamp
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { lastMessageAt: new Date() }
        });

        // Broadcast to all in conversation room
        io.to(`conversation:${conversationId}`).emit('message:new', { message });

        // Send push notification to offline members
        await notifyOfflineMembers(conversationId, userId, message, io);

      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    // ── Typing indicator ─────────────────────
    socket.on('typing:start', ({ conversationId }) => {
      socket.to(`conversation:${conversationId}`).emit('typing:start', {
        userId, conversationId
      });
    });

    socket.on('typing:stop', ({ conversationId }) => {
      socket.to(`conversation:${conversationId}`).emit('typing:stop', {
        userId, conversationId
      });
    });

    // ── Message read receipt ─────────────────
    socket.on('message:read', async ({ messageId, conversationId }) => {
      try {
        await prisma.messageReceipt.upsert({
          where: { messageId_userId: { messageId, userId } },
          update: { readAt: new Date() },
          create: { messageId, userId, readAt: new Date() }
        });
        io.to(`conversation:${conversationId}`).emit('message:read', { messageId, userId });
      } catch (err) {}
    });

    // ── Call signaling ───────────────────────
    socket.on('call:offer', (data) => {
      socket.to(`user:${data.targetUserId}`).emit('call:offer', {
        ...data, from: userId
      });
    });

    socket.on('call:answer', (data) => {
      socket.to(`user:${data.targetUserId}`).emit('call:answer', {
        ...data, from: userId
      });
    });

    socket.on('call:ice-candidate', (data) => {
      socket.to(`user:${data.targetUserId}`).emit('call:ice-candidate', {
        ...data, from: userId
      });
    });

    socket.on('call:end', (data) => {
      socket.to(`user:${data.targetUserId}`).emit('call:end', { from: userId });
    });

    // ── Disconnect ───────────────────────────
    socket.on('disconnect', async () => {
      const sockets = onlineUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(userId);
          socket.broadcast.emit('user:offline', { userId });
          await prisma.user.update({ where: { id: userId }, data: { lastSeen: new Date() } });
        }
      }
    });
  });
}

async function joinUserRooms(socket) {
  const userId = socket.userId;
  // Join personal room
  socket.join(`user:${userId}`);
  // Join all conversation rooms
  const participations = await prisma.conversationParticipant.findMany({
    where: { userId },
    select: { conversationId: true }
  });
  participations.forEach(p => socket.join(`conversation:${p.conversationId}`));
}

async function notifyOfflineMembers(conversationId, senderId, message, io) {
  try {
    const participants = await prisma.conversationParticipant.findMany({
      where: { conversationId, userId: { not: senderId } },
      include: { user: { select: { id:1, fcmToken:1 } } }
    });
    for (const p of participants) {
      if (!onlineUsers.has(p.user.id) && p.user.fcmToken) {
        // Push notification would be sent here via Firebase
        // firebaseAdmin.messaging().send({ token: p.user.fcmToken, ... })
        await prisma.notification.create({
          data: {
            userId: p.user.id,
            title: 'New message',
            body: message.content || 'Sent an attachment',
            data: { conversationId, messageId: message.id }
          }
        });
      }
    }
  } catch (err) {}
}

function isUserOnline(userId) {
  return onlineUsers.has(userId) && onlineUsers.get(userId).size > 0;
}

module.exports = { setupSocketHandlers, isUserOnline };
