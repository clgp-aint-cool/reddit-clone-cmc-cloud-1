async function initPgTables(pool) {
  try {
    console.log('Verifying PostgreSQL schemas...');
    
    // Create follows table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS follows (
        follower_id INT NOT NULL,
        followed_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (follower_id, followed_id),
        FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (followed_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
    
    // Create community_members (subreddit subscriptions) table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS community_members (
        user_id INT NOT NULL,
        community_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, community_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE
      );
    `);
    
    console.log('PostgreSQL schemas verified successfully');
  } catch (err) {
    console.error('Error verifying/creating PostgreSQL schemas:', err.message);
  }
}

module.exports = { initPgTables };
