const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  userId: { 
    type: Number, 
    required: true 
  }, // Recipient of the notification (references PostgreSQL users.id)
  type: { 
    type: String, 
    required: true,
    enum: ['comment_reply', 'post_upvote', 'comment_upvote', 'mention', 'follow', 'new_post']
  },
  sender: {
    id: { type: Number, required: true },
    username: { type: String, required: true }
  },
  entityId: { 
    type: Number, 
    required: true 
  }, // Target entity ID (post_id, comment_id, or user_id)
  entityType: { 
    type: String, 
    required: true,
    enum: ['post', 'comment', 'user']
  },
  communityName: { 
    type: String 
  }, // Optional: Name of community/subreddit (e.g. for 'new_post' events)
  title: { 
    type: String, 
    required: true 
  }, // Pre-rendered display title (e.g. "u/alice replied to your comment")
  contentSnippet: { 
    type: String 
  }, // Optional: snippet of comment content or post content
  isRead: { 
    type: Boolean, 
    default: false 
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Indexes for fast querying and sorting
// 1. Querying all notifications for a user by time descending (e.g. feed load)
NotificationSchema.index({ userId: 1, createdAt: -1 });

// 2. Querying only unread notifications, or calculating unread count using Index-Only Scan
NotificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

// 3. TTL Index to delete notifications older than 30 days automatically
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 });

module.exports = mongoose.model('Notification', NotificationSchema);
