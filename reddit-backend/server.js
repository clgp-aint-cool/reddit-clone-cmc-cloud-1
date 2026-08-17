// Polyfill global crypto for Node.js environments where it is not exposed globally
if (typeof globalThis.crypto === 'undefined' || typeof globalThis.crypto.randomUUID !== 'function') {
  const cryptoModule = require('crypto');
  globalThis.crypto = cryptoModule.webcrypto || cryptoModule;
}

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const http = require('http');

// Import MongoDB & real-time notification modules
const { connectMongo } = require('./db');
const { initPgTables } = require('./db-pg-init');
const { initSocket } = require('./socket');
const notifService = require('./notification.service');

const app = express();
app.use(cors());
app.use(express.json({ limit: '3mb' }));

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

// Connect to MongoDB and verify PostgreSQL tables on start
connectMongo();
initPgTables(pool);

function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try { req.user = jwt.verify(h.split(' ')[1], process.env.JWT_SECRET); next() }
  catch { return res.status(401).json({ error: 'Invalid token' }) }
}
function validateImage(image) {
  if (image === undefined) return undefined;
  if (image === null || image === "") return null;
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(image)) throw new Error('Unsupported image format');
  if (image.length > 1500000) throw new Error('Image is too large');
  return image;
}
async function getPost(id) {
  const r = await pool.query(`
    SELECT p.id,p.title,p.content,p.image_data,p.created_at,
           u.id AS user_id,u.username,
           c.id AS community_id,c.name AS community,
           COALESCE(SUM(v.vote),0)::int AS score,
           COUNT(DISTINCT cm.id)::int AS comment_count
    FROM posts p
    JOIN users u ON u.id=p.user_id
    LEFT JOIN communities c ON c.id=p.community_id
    LEFT JOIN votes v ON v.post_id=p.id
    LEFT JOIN comments cm ON cm.post_id=p.id
    WHERE p.id=$1
    GROUP BY p.id,u.id,u.username,c.id,c.name
  `, [id]);
  return r.rows[0];
}

app.get('/', (req, res) => res.json({ message: 'Clouddit Backend API', server: process.env.SERVER_NAME || 'backend' }));
app.get('/health', (req, res) => res.json({ status: 'healthy', server: process.env.SERVER_NAME || 'backend' }));

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'Missing fields' });
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(`INSERT INTO users(username,email,password_hash) VALUES($1,$2,$3) RETURNING id,username,email,created_at`, [username, email, hash]);
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Username or email already exists' });
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const r = await pool.query('SELECT * FROM users WHERE username=$1', [username]);
    if (!r.rows.length) return res.status(401).json({ error: 'Invalid username or password' });
    const u = r.rows[0];
    if (!await bcrypt.compare(password, u.password_hash)) return res.status(401).json({ error: 'Invalid username or password' });
    const token = jwt.sign({ id: u.id, username: u.username }, process.env.JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { id: u.id, username: u.username, email: u.email } });
  } catch (e) { res.status(500).json({ error: e.message }) }
});

app.get('/api/communities', async (req, res) => {
  try { const r = await pool.query('SELECT * FROM communities ORDER BY name'); res.json(r.rows) }
  catch (e) { res.status(500).json({ error: e.message }) }
});

app.get('/api/posts', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT p.id,p.title,p.content,p.image_data,p.created_at,
             u.id AS user_id,u.username,
             c.id AS community_id,c.name AS community,
             COALESCE(SUM(v.vote),0)::int AS score,
             COUNT(DISTINCT cm.id)::int AS comment_count
      FROM posts p
      JOIN users u ON u.id=p.user_id
      LEFT JOIN communities c ON c.id=p.community_id
      LEFT JOIN votes v ON v.post_id=p.id
      LEFT JOIN comments cm ON cm.post_id=p.id
      GROUP BY p.id,u.id,u.username,c.id,c.name
      ORDER BY p.created_at DESC
    `);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }) }
});

app.get('/api/posts/:id', async (req, res) => {
  try {
    const p = await getPost(req.params.id);
    if (!p) return res.status(404).json({ error: 'Post not found' });
    res.json(p);
  } catch (e) { res.status(500).json({ error: e.message }) }
});

app.post('/api/posts', auth, async (req, res) => {
  try {
    const { title, content, community_id } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });
    let image = null; try { image = validateImage(req.body.image_data) } catch (e) { return res.status(400).json({ error: e.message }) }
    const r = await pool.query(`INSERT INTO posts(user_id,community_id,title,content,image_data) VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [req.user.id, community_id || null, title, content || '', image]);

    // Post notifications trigger (asynchronous, non-blocking)
    if (community_id) {
      (async () => {
        try {
          const members = await pool.query('SELECT user_id FROM community_members WHERE community_id = $1', [community_id]);
          const commNameResult = await pool.query('SELECT name FROM communities WHERE id = $1', [community_id]);
          const communityName = commNameResult.rows[0]?.name || 'general';
          for (const m of members.rows) {
            await notifService.createNotification({
              userId: m.user_id,
              type: 'new_post',
              sender: { id: req.user.id, username: req.user.username },
              entityId: r.rows[0].id,
              entityType: 'post',
              communityName: communityName,
              title: `New post in r/${communityName} by u/${req.user.username}`
            });
          }
        } catch (err) {
          console.error('Failed to trigger post notifications:', err);
        }
      })();
    }

    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }) }
});

app.patch('/api/posts/:id', auth, async (req, res) => {
  try {
    const owned = await pool.query('SELECT * FROM posts WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!owned.rows.length) return res.status(403).json({ error: 'You can edit only your own post' });
    const old = owned.rows[0];
    let image = old.image_data;
    if (req.body.image_data !== undefined) {
      try { image = validateImage(req.body.image_data) } catch (e) { return res.status(400).json({ error: e.message }) }
    }
    const r = await pool.query(`UPDATE posts SET title=$1,content=$2,image_data=$3 WHERE id=$4 AND user_id=$5 RETURNING *`,
      [req.body.title ?? old.title, req.body.content ?? old.content, image, req.params.id, req.user.id]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }) }
});

app.delete('/api/posts/:id', auth, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM posts WHERE id=$1 AND user_id=$2 RETURNING id', [req.params.id, req.user.id]);
    if (!r.rows.length) return res.status(403).json({ error: 'You can delete only your own post' });
    res.json({ deleted: true, id: r.rows[0].id });
  } catch (e) { res.status(500).json({ error: e.message }) }
});

app.get('/api/posts/:id/comments', async (req, res) => {
  try {
    const r = await pool.query(`SELECT c.id,c.content,c.created_at,u.id AS user_id,u.username FROM comments c JOIN users u ON u.id=c.user_id WHERE c.post_id=$1 ORDER BY c.created_at ASC`, [req.params.id]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }) }
});

app.post('/api/posts/:id/comments', auth, async (req, res) => {
  try {
    const content = req.body.content;
    if (!content) return res.status(400).json({ error: 'Comment content required' });
    const r = await pool.query(`INSERT INTO comments(post_id,user_id,content) VALUES($1,$2,$3) RETURNING *`, [req.params.id, req.user.id, content]);
    const comment = r.rows[0];

    // Asynchronously trigger notifications
    (async () => {
      try {
        // 1. Fetch Post details
        const postRes = await pool.query('SELECT user_id, title FROM posts WHERE id = $1', [req.params.id]);
        if (postRes.rows.length > 0) {
          const post = postRes.rows[0];

          // Trigger comment_reply notification
          await notifService.createNotification({
            userId: post.user_id,
            type: 'comment_reply',
            sender: { id: req.user.id, username: req.user.username },
            entityId: comment.id,
            entityType: 'comment',
            title: `u/${req.user.username} commented on your post "${post.title}"`,
            contentSnippet: content.slice(0, 100)
          });
        }

        // 2. Parse Mentions (e.g. @alice, @bob)
        const mentionRegex = /@(\w+)/g;
        let match;
        const mentionedUsernames = new Set();
        while ((match = mentionRegex.exec(content)) !== null) {
          mentionedUsernames.add(match[1]);
        }

        if (mentionedUsernames.size > 0) {
          const usernamesArray = Array.from(mentionedUsernames);
          const usersRes = await pool.query('SELECT id, username FROM users WHERE username = ANY($1)', [usernamesArray]);

          for (const u of usersRes.rows) {
            await notifService.createNotification({
              userId: u.id,
              type: 'mention',
              sender: { id: req.user.id, username: req.user.username },
              entityId: comment.id,
              entityType: 'comment',
              title: `u/${req.user.username} mentioned you in a comment`,
              contentSnippet: content.slice(0, 100)
            });
          }
        }
      } catch (err) {
        console.error('Failed to trigger comment notifications:', err);
      }
    })();

    res.status(201).json(comment);
  } catch (e) { res.status(500).json({ error: e.message }) }
});

app.post('/api/posts/:id/vote', auth, async (req, res) => {
  try {
    const voteVal = req.body.vote;
    if (![1, -1].includes(voteVal)) return res.status(400).json({ error: 'Vote must be 1 or -1' });
    await pool.query(`INSERT INTO votes(user_id,post_id,vote) VALUES($1,$2,$3) ON CONFLICT(user_id,post_id) DO UPDATE SET vote=EXCLUDED.vote`,
      [req.user.id, req.params.id, voteVal]);

    // Trigger notification if upvote (voteVal === 1)
    if (voteVal === 1) {
      (async () => {
        try {
          const postRes = await pool.query('SELECT user_id, title FROM posts WHERE id = $1', [req.params.id]);
          if (postRes.rows.length > 0) {
            const post = postRes.rows[0];
            await notifService.createNotification({
              userId: post.user_id,
              type: 'post_upvote',
              sender: { id: req.user.id, username: req.user.username },
              entityId: req.params.id,
              entityType: 'post',
              title: `u/${req.user.username} upvoted your post`
            });
          }
        } catch (err) {
          console.error('Failed to trigger upvote notification:', err);
        }
      })();
    }

    const r = await pool.query(`SELECT COALESCE(SUM(vote),0)::int AS score FROM votes WHERE post_id=$1`, [req.params.id]);
    res.json({ score: r.rows[0].score });
  } catch (e) { res.status(500).json({ error: e.message }) }
});

// ==================== FOLLOWS & COMMUNITY MEMBERSHIPS ENDPOINTS ====================

// Follow/Unfollow a user
app.post('/api/users/:id/follow', auth, async (req, res) => {
  try {
    const followedId = Number(req.params.id);
    if (followedId === req.user.id) {
      return res.status(400).json({ error: 'You cannot follow yourself' });
    }

    // Check if user is already following
    const check = await pool.query('SELECT * FROM follows WHERE follower_id = $1 AND followed_id = $2', [req.user.id, followedId]);
    if (check.rows.length > 0) {
      // Unfollow
      await pool.query('DELETE FROM follows WHERE follower_id = $1 AND followed_id = $2', [req.user.id, followedId]);
      res.json({ followed: false });
    } else {
      // Follow
      await pool.query('INSERT INTO follows (follower_id, followed_id) VALUES ($1, $2)', [req.user.id, followedId]);

      // Trigger notification
      (async () => {
        try {
          await notifService.createNotification({
            userId: followedId,
            type: 'follow',
            sender: { id: req.user.id, username: req.user.username },
            entityId: req.user.id,
            entityType: 'user',
            title: `u/${req.user.username} started following you`
          });
        } catch (err) {
          console.error('Failed to trigger follow notification:', err);
        }
      })();

      res.json({ followed: true });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Join/Leave a community
app.post('/api/communities/:id/join', auth, async (req, res) => {
  try {
    const communityId = Number(req.params.id);

    // Check if already joined
    const check = await pool.query('SELECT * FROM community_members WHERE user_id = $1 AND community_id = $2', [req.user.id, communityId]);
    if (check.rows.length > 0) {
      // Leave
      await pool.query('DELETE FROM community_members WHERE user_id = $1 AND community_id = $2', [req.user.id, communityId]);
      res.json({ joined: false });
    } else {
      // Join
      await pool.query('INSERT INTO community_members (user_id, community_id) VALUES ($1, $2)', [req.user.id, communityId]);
      res.json({ joined: true });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Check if user is following another user
app.get('/api/users/:id/following', auth, async (req, res) => {
  try {
    const check = await pool.query('SELECT * FROM follows WHERE follower_id = $1 AND followed_id = $2', [req.user.id, req.params.id]);
    res.json({ followed: check.rows.length > 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Check if user has joined community
app.get('/api/communities/:id/joined', auth, async (req, res) => {
  try {
    const check = await pool.query('SELECT * FROM community_members WHERE user_id = $1 AND community_id = $2', [req.user.id, req.params.id]);
    res.json({ joined: check.rows.length > 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== NOTIFICATIONS ENDPOINTS ====================

// GET paginated notifications list
app.get('/api/notifications', auth, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 15), 50);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const notifications = await notifService.getNotifications(req.user.id, limit, offset);
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET unread notifications count
app.get('/api/notifications/unread-count', auth, async (req, res) => {
  try {
    const count = await notifService.getUnreadCount(req.user.id);
    res.json({ unreadCount: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH mark single notification as read
app.patch('/api/notifications/:id/mark-read', auth, async (req, res) => {
  try {
    const notif = await notifService.markAsRead(req.user.id, req.params.id);
    if (!notif) return res.status(404).json({ error: 'Notification not found' });
    res.json(notif);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH mark all notifications as read
app.patch('/api/notifications/mark-all-read', auth, async (req, res) => {
  try {
    await notifService.markAsRead(req.user.id, null);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start Server using http to bundle socket.io
const server = http.createServer(app);
initSocket(server);

server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => {
  console.log(`${process.env.SERVER_NAME || 'Backend'} running on port ${process.env.PORT || 3000}`);
});
