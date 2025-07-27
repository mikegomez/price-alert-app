const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Initialize database tables
const initializeDB = async () => {
  const connection = await pool.getConnection();
  
  try {
    // Users table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Price alerts table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS price_alerts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        symbol VARCHAR(10) NOT NULL,
        target_price DECIMAL(10,2) NOT NULL,
        alert_type ENUM('above', 'below') NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        triggered_at TIMESTAMP NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )
    `);

    // Paper trading portfolio table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS portfolio (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        symbol VARCHAR(10) NOT NULL,
        shares INT NOT NULL,
        purchase_price DECIMAL(10,2) NOT NULL,
        purchase_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_sold BOOLEAN DEFAULT FALSE,
        sold_price DECIMAL(10,2) NULL,
        sold_date TIMESTAMP NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )
    `);

    // Stock prices cache table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS stock_prices (
        symbol VARCHAR(10) PRIMARY KEY,
        price DECIMAL(10,2) NOT NULL,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    console.log('Database tables initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  } finally {
    connection.release();
  }
};

// Helper functions for database operations
const dbHelpers = {
  // Get user by email
  getUserByEmail: async (email) => {
    const [rows] = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);
    return rows[0] || null;
  },

  // Create new user
  createUser: async (email, passwordHash) => {
    const [result] = await pool.execute(
      'INSERT INTO users (email, password_hash) VALUES (?, ?)', 
      [email, passwordHash]
    );
    return result.insertId;
  },

  // Get user alerts
  getUserAlerts: async (userId) => {
    const [rows] = await pool.execute(
      'SELECT * FROM price_alerts WHERE user_id = ? AND is_active = TRUE', 
      [userId]
    );
    return rows;
  },

  // Create price alert
  createAlert: async (userId, symbol, targetPrice, alertType) => {
    const [result] = await pool.execute(
      'INSERT INTO price_alerts (user_id, symbol, target_price, alert_type) VALUES (?, ?, ?, ?)', 
      [userId, symbol, targetPrice, alertType]
    );
    return result.insertId;
  },

  // Get all active alerts
  getAllActiveAlerts: async () => {
    const [rows] = await pool.execute(`
      SELECT pa.*, u.email 
      FROM price_alerts pa 
      JOIN users u ON pa.user_id = u.id 
      WHERE pa.is_active = TRUE
    `);
    return rows;
  },

  // Trigger alert
  triggerAlert: async (alertId) => {
    await pool.execute(
      'UPDATE price_alerts SET is_active = FALSE, triggered_at = NOW() WHERE id = ?', 
      [alertId]
    );
  },

  // Get user portfolio
  getUserPortfolio: async (userId) => {
    const [rows] = await pool.execute('SELECT * FROM portfolio WHERE user_id = ?', [userId]);
    return rows;
  },

  // Add to portfolio
  addToPortfolio: async (userId, symbol, shares, purchasePrice) => {
    const [result] = await pool.execute(
      'INSERT INTO portfolio (user_id, symbol, shares, purchase_price) VALUES (?, ?, ?, ?)', 
      [userId, symbol, shares, purchasePrice]
    );
    return result.insertId;
  },

  // Sell from portfolio
  sellFromPortfolio: async (portfolioId, soldPrice) => {
    await pool.execute(
      'UPDATE portfolio SET is_sold = TRUE, sold_price = ?, sold_date = NOW() WHERE id = ?',
      [soldPrice, portfolioId]
    );
  },

  // Update stock price
  updateStockPrice: async (symbol, price) => {
    await pool.execute(
      'INSERT INTO stock_prices (symbol, price) VALUES (?, ?) ON DUPLICATE KEY UPDATE price = ?, last_updated = NOW()', 
      [symbol, price, price]
    );
  },

  // Get stock price
  getStockPrice: async (symbol) => {
    const [rows] = await pool.execute('SELECT * FROM stock_prices WHERE symbol = ?', [symbol]);
    return rows[0] || null;
  },

  // Get multiple stock prices
  getStockPrices: async (symbols) => {
    if (!symbols || symbols.length === 0) return [];
    const placeholders = symbols.map(() => '?').join(',');
    const [rows] = await pool.execute(
      `SELECT * FROM stock_prices WHERE symbol IN (${placeholders})`, 
      symbols
    );
    return rows;
  },

  // Delete alert
  deleteAlert: async (alertId, userId) => {
    const [result] = await pool.execute(
      'DELETE FROM price_alerts WHERE id = ? AND user_id = ?', 
      [alertId, userId]
    );
    return result.affectedRows > 0;
  },

  // Get user by ID
  getUserById: async (userId) => {
    const [rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [userId]);
    return rows[0] || null;
  }
};

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Closing MySQL connection pool...');
  await pool.end();
  process.exit(0);
});

module.exports = { pool, initializeDB, dbHelpers };