const Notification = require('./notification.model');
const { sendNotification } = require('./socket');

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
    // Exclude notifications where user is acting on their own content
    if (Number(userId) === Number(sender.id)) {
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
          return existing;
        }

        // Update the title to reflect multiple upvotes, update the last sender, and bump the timestamp
        existing.title = `u/${sender.username} and others upvoted your post`;
        existing.sender = { id: sender.id, username: sender.username };
        existing.createdAt = new Date();
        const savedNotif = await existing.save();
        
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
    
    // Push real-time event to socket room
    sendNotification(userId, savedNotif);
    
    return savedNotif;
  } catch (err) {
    console.error('Error creating notification in service:', err);
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
 * Fetch count of unread notifications for a user
 */
async function getUnreadCount(userId) {
  try {
    return await Notification.countDocuments({ userId, isRead: false });
  } catch (err) {
    console.error('Error fetching unread count:', err);
    throw err;
  }
}

/**
 * Mark a single notification or all user's notifications as read
 */
async function markAsRead(userId, notificationId = null) {
  try {
    if (notificationId) {
      return await Notification.findOneAndUpdate(
        { _id: notificationId, userId },
        { isRead: true },
        { new: true }
      );
    } else {
      return await Notification.updateMany(
        { userId, isRead: false },
        { isRead: true }
      );
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
