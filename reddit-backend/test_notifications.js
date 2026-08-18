// Polyfill global crypto for Node.js environments where it is not exposed globally
if (typeof globalThis.crypto === 'undefined' || typeof globalThis.crypto.randomUUID !== 'function') {
  const cryptoModule = require('crypto');
  globalThis.crypto = cryptoModule.webcrypto || cryptoModule;
}

require('dotenv').config();
const mongoose = require('mongoose');

// Mock socket.js dependency before importing notification.service
const socketMock = {
  emitted: [],
  sendNotification(userId, payload) {
    this.emitted.push({ userId, payload });
  },
  reset() {
    this.emitted = [];
  }
};
require('./socket').sendNotification = socketMock.sendNotification.bind(socketMock);

const Notification = require('./notification.model');
const notifService = require('./notification.service');

async function runTests() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/reddit_notifications';
  
  console.log('--- Connecting to test MongoDB at:', mongoUri);
  try {
    await mongoose.connect(mongoUri);
    console.log('MongoDB connected successfully for testing');
  } catch (err) {
    console.error('Failed to connect to MongoDB. Make sure MongoDB is running locally.', err.message);
    process.exit(1);
  }

  // Connect to Redis for testing
  const { connectRedis } = require('./redis');
  await connectRedis();

  // Clear existing notifications
  await Notification.deleteMany({});
  console.log('Notifications collection cleared.');

  // Test Case 1: Create a comment reply notification
  console.log('\n--- Test Case 1: Creating Comment Reply Notification ---');
  socketMock.reset();
  const notif1 = await notifService.createNotification({
    userId: 1, // User A
    type: 'comment_reply',
    sender: { id: 2, username: 'bob' }, // User B
    entityId: 101, // Post ID
    entityType: 'post',
    title: 'u/bob commented on your post "My first post"',
    contentSnippet: 'This is an awesome post!'
  });

  if (notif1) {
    console.log('Success: Notification created.');
    console.log('Inserted Document Title:', notif1.title);
    console.log('Socket Broadcast Emitted:', socketMock.emitted.length === 1 && socketMock.emitted[0].userId === 1);
  } else {
    console.error('Failed to create notification.');
  }

  // Test Case 2: Unread count
  console.log('\n--- Test Case 2: Fetching Unread Count ---');
  const count1 = await notifService.getUnreadCount(1);
  console.log('Unread count for User 1:', count1);
  if (count1 === 1) {
    console.log('Success: Count is correct.');
  } else {
    console.error('Failed: Expected 1, got', count1);
  }

  // Test Case 3: Upvote deduplication
  console.log('\n--- Test Case 3: Upvote Deduplication (Grouping) ---');
  socketMock.reset();
  
  // Alice upvotes User A's post (101)
  const upvote1 = await notifService.createNotification({
    userId: 1,
    type: 'post_upvote',
    sender: { id: 3, username: 'alice' },
    entityId: 101,
    entityType: 'post',
    title: 'u/alice upvoted your post'
  });
  console.log('First upvote title:', upvote1.title);

  // Bob upvotes the same post (101) within 24 hours
  const upvote2 = await notifService.createNotification({
    userId: 1,
    type: 'post_upvote',
    sender: { id: 2, username: 'bob' },
    entityId: 101,
    entityType: 'post',
    title: 'u/bob upvoted your post'
  });
  console.log('Second upvote title (should be grouped):', upvote2.title);

  const totalDocs = await Notification.countDocuments({ userId: 1, type: 'post_upvote' });
  console.log('Total upvote notification documents in DB:', totalDocs);
  
  if (totalDocs === 1 && upvote2.title.includes('and others upvoted your post')) {
    console.log('Success: Deduplication works correctly.');
  } else {
    console.error('Failed: Expected 1 document with grouped title, got:', totalDocs, 'Title:', upvote2.title);
  }

  // Test Case 4: Mark notifications as read
  console.log('\n--- Test Case 4: Marking Notifications as Read ---');
  await notifService.markAsRead(1, null); // Mark all for user 1
  const count2 = await notifService.getUnreadCount(1);
  console.log('Unread count for User 1 after mark all read:', count2);
  if (count2 === 0) {
    console.log('Success: All marked as read.');
  } else {
    console.error('Failed: Expected 0, got', count2);
  }

  // Test Case 5: Verify Redis Caching
  console.log('\n--- Test Case 5: Verifying Redis Cache Logic ---');
  const { getCache, delCache } = require('./redis');
  
  // Clear any existing cache for user 1
  await delCache('unread_count:1');
  
  // Trigger cache miss and load count (this queries Mongo and sets Redis)
  const countBefore = await notifService.getUnreadCount(1);
  console.log('Count before (triggers Mongo query & populates cache):', countBefore);
  
  // Fetch value directly from Redis cache to verify it was set
  const cachedVal = await getCache('unread_count:1');
  console.log('Direct Redis cache lookup value:', cachedVal);
  
  if (cachedVal !== null && Number(cachedVal) === countBefore) {
    console.log('Success: Redis caching successfully saved value.');
  } else {
    console.error('Failed: Redis cache key unread_count:1 was not set properly. Got:', cachedVal);
  }

  // Close MongoDB and disconnect Redis client
  await mongoose.disconnect();
  
  // Gracefully close Redis connections so script exits cleanly
  const { createClient } = require('redis');
  // We can just call process.exit(0) to terminate the test script clean
  console.log('\n--- Testing Completed ---');
  process.exit(0);
}

runTests().catch(console.error);
