const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const { publishEvent, subscribeToChannel } = require('./redis');

let io = null;

function initSocket(server) {
  io = socketIo(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  io.use((socket, next) => {
    // Check both handshakes (for flexible integration on client side)
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) {
      return next(new Error('Authentication error: Token is required'));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded; // Attach user payload ({ id, username }) to socket
      next();
    } catch (err) {
      return next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user.id;
    const roomName = `user:${userId}`;
    
    socket.join(roomName);
    console.log(`Socket user connected: ${socket.user.username} (ID: ${userId}) joined room: ${roomName}`);

    socket.on('disconnect', () => {
      console.log(`Socket user disconnected: ${socket.user.username} (ID: ${userId}) left room: ${roomName}`);
    });
  });

  // Subscribe to Redis notifications channel to listen for broadcast events from other instances
  subscribeToChannel('notifications', (data) => {
    if (io && data && data.userId && data.notification) {
      const roomName = `user:${data.userId}`;
      io.to(roomName).emit('notification', data.notification);
      console.log(`[Redis Subscriber] Forwarded real-time notification to socket room: ${roomName}`);
    }
  });

  return io;
}

function sendNotification(userId, notificationPayload) {
  // Publish the notification to Redis Pub/Sub.
  // This allows all active Express server nodes to receive the event and emit it to their connected users.
  publishEvent('notifications', { userId, notification: notificationPayload });
  console.log(`[Redis Publisher] Published notification event to Redis channel for user ID: ${userId}`);
}

module.exports = {
  initSocket,
  sendNotification
};

