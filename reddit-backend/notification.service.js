const Notification = require('./notification.model');
const { sendNotification } = require('./socket');
const { getCache, setCache, delCache, incrCache } = require('./redis');

/**
 * Create a new notification or update an existing one if applicable (deduplication)
 */
async function createNotification({
  userId,
  type,
  sender,
  entityId,
  entityType,
  communityName,
  title,
  contentSnippet
}) {
  // Fail-safe wrapper: notifications should never crash the main application request
  try {
    console.log(`[Notification Service] Incoming event. Type: "${type}", Sender: "u/${sender.username}" (ID: ${sender.id}), Recipient ID: ${userId}`);

    // Exclude notifications where user is acting on their own content
    if (Number(userId) === Number(sender.id)) {
      console.log(`[Notification Service] Skipped: Actor and recipient are the same user (ID: ${userId}).`);
      return null;
    }

    // Deduplication/Grouping logic for upvotes
    if (type === 'post_upvote') {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const existing = await Notification.findOne({
        userId,
        entityId,
        type: 'post_upvote',
        isRead: false,
        createdAt: { $gte: oneDayAgo }
      });

      if (existing) {
        // If the same sender triggered this again (e.g. toggling vote), do not create/update
        if (existing.sender.id === sender.id) {
          console.log(`[Notification Service] Skipped upvote: Same sender (ID: ${sender.id}) upvote toggle.`);
          return existing;
        }

        // Update the title to reflect multiple upvotes, update the last sender, and bump the timestamp
        existing.title = `u/${sender.username} and others upvoted your post`;
        existing.sender = { id: sender.id, username: sender.username };
        existing.createdAt = new Date();
        const savedNotif = await existing.save();
        
        console.log(`[Notification Service] MongoDB Updated (Deduplicated Upvote): Document ID: ${savedNotif._id}, New Title: "${savedNotif.title}"`);
        
        // Push updated notification real-time
        sendNotification(userId, savedNotif);
        return savedNotif;
      }
    }

    // Create new notification document
    const notification = new Notification({
      userId,
      type,
      sender,
      entityId,
      entityType,
      communityName,
      title,
      contentSnippet
    });

    const savedNotif = await notification.save();
    console.log(`[Notification Service] MongoDB Saved: Document ID: ${savedNotif._id}, Type: "${type}", Title: "${savedNotif.title}"`);
    
    // Increment cached unread count in Redis (if key exists)
    await incrCache(`unread_count:${userId}`);

    // Push real-time event to socket room
    sendNotification(userId, savedNotif);
    
    return savedNotif;
  } catch (err) {
    console.error('[Notification Service] Error creating notification in MongoDB:', err);
    return null;
  }
}

/**
 * Fetch paginated notifications list for a specific user
 */
async function getNotifications(userId, limit = 10, offset = 0) {
  try {
    return await Notification.find({ userId })
      .sort({ createdAt: -1 })
      .skip(Number(offset))
      .limit(Number(limit));
  } catch (err) {
    console.error('Error fetching notifications:', err);
    throw err;
  }
}

/**
 * Fetch count of unread notifications for a user (uses Redis cache)
 */
async function getUnreadCount(userId) {
  const cacheKey = `unread_count:${userId}`;
  try {
    // 1. Try to read from Redis cache
    const cachedValue = await getCache(cacheKey);
    if (cachedValue !== null) {
      console.log(`[Notification Service] Cache Hit: Unread count for user ${userId} is ${cachedValue}`);
      return Number(cachedValue);
    }

    // 2. Cache Miss: Query MongoDB
    console.log(`[Notification Service] Cache Miss: Querying MongoDB unread count for user ${userId}`);
    const count = await Notification.countDocuments({ userId, isRead: false });

    // 3. Save to Redis cache (expires in 1 hour / 3600 seconds)
    await setCache(cacheKey, count, 3600);
    return count;
  } catch (err) {
    console.error('Error fetching unread count:', err);
    throw err;
  }
}

/**
 * Mark a single notification or all user's notifications as read (updates/invalidates Redis cache)
 */
async function markAsRead(userId, notificationId = null) {
  const cacheKey = `unread_count:${userId}`;
  try {
    if (notificationId) {
      const notif = await Notification.findOneAndUpdate(
        { _id: notificationId, userId },
        { isRead: true },
        { returnDocument: 'after' }
      );
      // Invalidate cached unread count so it will rebuild on next query
      await delCache(cacheKey);
      return notif;
    } else {
      const result = await Notification.updateMany(
        { userId, isRead: false },
        { isRead: true }
      );
      // Set unread count directly to 0 in Redis cache
      await setCache(cacheKey, 0, 3600);
      return result;
    }
  } catch (err) {
    console.error('Error marking notifications as read:', err);
    throw err;
  }
}

module.exports = {
  createNotification,
  getNotifications,
  getUnreadCount,
  markAsRead
};
