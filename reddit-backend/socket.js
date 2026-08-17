const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');

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

  return io;
}

function sendNotification(userId, notificationPayload) {
  if (!io) {
    console.warn('Socket.io is not initialized yet. Skipping real-time notification push.');
    return;
  }
  
  const roomName = `user:${userId}`;
  // Emit 'notification' event with the payload to all sockets joined in the room
  io.to(roomName).emit('notification', notificationPayload);
  console.log(`Real-time notification emitted to room: ${roomName}`);
}

module.exports = {
  initSocket,
  sendNotification
};
