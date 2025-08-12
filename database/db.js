const mysql = require('mysql2/promise');

// Validate required environment variables
const requiredEnvVars = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:', missingVars.join(', '));
  process.exit(1);
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 5, // Lower limit for external hosting
  queueLimit: 0,
  charset: 'utf8mb4',
  // SSL configuration for external connections
  ssl: process.env.DB_SSL === 'true' ? {
    rejectUnauthorized: false
  } : false
});

// Test database connection with detailed error reporting
const testConnection = async () => {
  try {
    console.log('Testing database connection...');
    console.log(`Host: ${process.env.DB_HOST}`);
    console.log(`User: ${process.env.DB_USER}`);
    console.log(`Database: ${process.env.DB_NAME}`);
    console.log(`Port: ${process.env.DB_PORT || 3306}`);
    
    const connection = await pool.getConnection();
    console.log('✅ Database connection successful');
    
    // Test a simple query
    const [rows] = await connection.execute('SELECT 1 as test');
    console.log('✅ Database query test successful');
    
    connection.release();
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:');
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
    console.error('Error details:', error);
    return false;
  }
};

// Initialize database tables
const initializeDB = async () => {
  // First test the connection
  const connectionSuccess = await testConnection();
  if (!connectionSuccess) {
    console.error('Skipping database initialization due to connection failure');
    return false;
  }

  const connection = await pool.getConnection();
  
  try {
    console.log('Initializing database tables...');

    // Users table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

// Password resets table
     await connection.execute(`
      CREATE TABLE IF NOT EXISTS password_resets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        token_hash CHAR(64) NOT NULL, 
        expires_at DATETIME NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX (user_id),
        INDEX (token_hash),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      `);

    // Price alerts table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS price_alerts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        symbol VARCHAR(20) NOT NULL,
        target_price DECIMAL(15,8) NOT NULL,
        alert_type ENUM('above', 'below') NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        triggered_at TIMESTAMP NULL,
        INDEX idx_user_active (user_id, is_active),
        INDEX idx_symbol (symbol),
        INDEX idx_active (is_active),
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ENGINE=InnoDB CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Paper trading portfolio table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS portfolio (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        symbol VARCHAR(20) NOT NULL,
        shares DECIMAL(15,8) NOT NULL,
        purchase_price DECIMAL(15,8) NOT NULL,
        purchase_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_sold BOOLEAN DEFAULT FALSE,
        sold_price DECIMAL(15,8) NULL,
        sold_date TIMESTAMP NULL,
        INDEX idx_user_symbol (user_id, symbol),
        INDEX idx_user_active (user_id, is_sold),
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ENGINE=InnoDB CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Stock prices cache table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS stock_prices (
        symbol VARCHAR(20) PRIMARY KEY,
        price DECIMAL(15,8) NOT NULL,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_updated (last_updated)
      ) ENGINE=InnoDB CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('✅ Database tables initialized successfully');
    return true;
  } catch (error) {
    console.error('❌ Error initializing database:', error);
    throw error;
  } finally {
    connection.release();
  }
};

// Password reset helpers (MySQL-style pseudo-code)
const crypto = require('crypto');

// Helper functions for database operations
const dbHelpers = {
  // Get user by email
  getUserByEmail: async (email) => {
    try {
      const [rows] = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);
      return rows[0] || null;
    } catch (error) {
      console.error('Error getting user by email:', error);
      throw error;
    }
  },

  // Password Reset Functions
  createPasswordReset: async (userId, tokenHash, expiresAt) => {
    try {
      const sql = `INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)`;
      const [result] = await pool.execute(sql, [userId, tokenHash, expiresAt]);
      return result.insertId;
    } catch (error) {
      console.error('Error creating password reset:', error);
      throw error;
    }
  },

  getPasswordResetByHash: async (tokenHash) => {
    try {
      const sql = `SELECT * FROM password_resets WHERE token_hash = ? AND expires_at > NOW() LIMIT 1`;
      const [rows] = await pool.execute(sql, [tokenHash]);
      return rows[0] || null;
    } catch (error) {
      console.error('Error getting password reset by hash:', error);
      throw error;
    }
  },

  deletePasswordResetById: async (id) => {
    try {
      const sql = `DELETE FROM password_resets WHERE id = ?`;
      const [result] = await pool.execute(sql, [id]);
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error deleting password reset:', error);
      throw error;
    }
  },

  updateUserPasswordHash: async (userId, newHash) => {
    try {
      const sql = `UPDATE users SET password_hash = ? WHERE id = ?`;
      const [result] = await pool.execute(sql, [newHash, userId]);
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error updating user password hash:', error);
      throw error;
    }
  },

  // Clean up expired password reset tokens
  cleanupExpiredResets: async () => {
    try {
      const [result] = await pool.execute(
        'DELETE FROM password_resets WHERE expires_at < NOW()'
      );
      return result.affectedRows;
    } catch (error) {
      console.error('Error cleaning up expired resets:', error);
      throw error;
    }
  },


  // Create new user
  createUser: async (email, passwordHash) => {
    try {
      const [result] = await pool.execute(
        'INSERT INTO users (email, password_hash) VALUES (?, ?)', 
        [email, passwordHash]
      );
      return result.insertId;
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    }
  },

  // Get user alerts
  getUserAlerts: async (userId) => {
    try {
      const [rows] = await pool.execute(
        'SELECT * FROM price_alerts WHERE user_id = ? AND is_active = TRUE ORDER BY created_at DESC', 
        [userId]
      );
      return rows;
    } catch (error) {
      console.error('Error getting user alerts:', error);
      throw error;
    }
  },

  // Create price alert
  createAlert: async (userId, symbol, targetPrice, alertType) => {
    try {
      const [result] = await pool.execute(
        'INSERT INTO price_alerts (user_id, symbol, target_price, alert_type) VALUES (?, ?, ?, ?)', 
        [userId, symbol.toUpperCase(), parseFloat(targetPrice), alertType]
      );
      return result.insertId;
    } catch (error) {
      console.error('Error creating alert:', error);
      throw error;
    }
  },

  // Get all active alerts
  getAllActiveAlerts: async () => {
    try {
      const [rows] = await pool.execute(`
        SELECT pa.*, u.email 
        FROM price_alerts pa 
        JOIN users u ON pa.user_id = u.id 
        WHERE pa.is_active = TRUE
        ORDER BY pa.created_at ASC
      `);
      return rows;
    } catch (error) {
      console.error('Error getting active alerts:', error);
      return []; // Return empty array on error to prevent app crash
    }
  },

  // Trigger alert
  triggerAlert: async (alertId) => {
    try {
      const [result] = await pool.execute(
        'UPDATE price_alerts SET is_active = FALSE, triggered_at = NOW() WHERE id = ?', 
        [alertId]
      );
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error triggering alert:', error);
      throw error;
    }
  },

  // Get user portfolio
  getUserPortfolio: async (userId) => {
    try {
      const [rows] = await pool.execute(
        'SELECT * FROM portfolio WHERE user_id = ? ORDER BY purchase_date DESC', 
        [userId]
      );
      return rows;
    } catch (error) {
      console.error('Error getting user portfolio:', error);
      throw error;
    }
  },

  // Add to portfolio
  addToPortfolio: async (userId, symbol, shares, purchasePrice) => {
    try {
      const [result] = await pool.execute(
        'INSERT INTO portfolio (user_id, symbol, shares, purchase_price) VALUES (?, ?, ?, ?)', 
        [userId, symbol.toUpperCase(), parseFloat(shares), parseFloat(purchasePrice)]
      );
      return result.insertId;
    } catch (error) {
      console.error('Error adding to portfolio:', error);
      throw error;
    }
  },

  // Sell from portfolio
  sellFromPortfolio: async (portfolioId, soldPrice) => {
    try {
      const [result] = await pool.execute(
        'UPDATE portfolio SET is_sold = TRUE, sold_price = ?, sold_date = NOW() WHERE id = ?',
        [parseFloat(soldPrice), portfolioId]
      );
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error selling from portfolio:', error);
      throw error;
    }
  },

  // Update stock price
  updateStockPrice: async (symbol, price) => {
    try {
      await pool.execute(
        'INSERT INTO stock_prices (symbol, price) VALUES (?, ?) ON DUPLICATE KEY UPDATE price = ?, last_updated = NOW()', 
        [symbol.toUpperCase(), parseFloat(price), parseFloat(price)]
      );
    } catch (error) {
      console.error('Error updating stock price:', error);
      // Don't throw error for price updates to prevent app crashes
    }
  },

  // Get stock price
  getStockPrice: async (symbol) => {
    try {
      const [rows] = await pool.execute('SELECT * FROM stock_prices WHERE symbol = ?', [symbol.toUpperCase()]);
      return rows[0] || null;
    } catch (error) {
      console.error('Error getting stock price:', error);
      return null;
    }
  },

  // Get multiple stock prices
  getStockPrices: async (symbols) => {
    if (!symbols || symbols.length === 0) return [];
    try {
      const upperSymbols = symbols.map(s => s.toUpperCase());
      const placeholders = upperSymbols.map(() => '?').join(',');
      const [rows] = await pool.execute(
        `SELECT * FROM stock_prices WHERE symbol IN (${placeholders})`, 
        upperSymbols
      );
      return rows;
    } catch (error) {
      console.error('Error getting stock prices:', error);
      return [];
    }
  },

  // Delete alert
  deleteAlert: async (alertId, userId) => {
    try {
      const [result] = await pool.execute(
        'DELETE FROM price_alerts WHERE id = ? AND user_id = ?', 
        [alertId, userId]
      );
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error deleting alert:', error);
      throw error;
    }
  },

  // Get user by ID
  getUserById: async (userId) => {
    try {
      const [rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [userId]);
      return rows[0] || null;
    } catch (error) {
      console.error('Error getting user by ID:', error);
      throw error;
    }
  }
};

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Closing MySQL connection pool...');
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Closing MySQL connection pool...');
  await pool.end();
  process.exit(0);
});

module.exports = { pool, initializeDB, dbHelpers, testConnection };