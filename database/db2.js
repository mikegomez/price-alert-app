const sqlite3 = require('sqlite3').verbose();
//const mysql = require('mysql2/promise');

const path = require('path');

// Create database connection
const dbPath = path.join(__dirname, 'alerts.db');
const db = new sqlite3.Database(dbPath);

// Initialize database tables
const initializeDB = () => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Users table
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Price alerts table
      db.run(`
        CREATE TABLE IF NOT EXISTS price_alerts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          symbol TEXT NOT NULL,
          target_price DECIMAL(10,2) NOT NULL,
          alert_type TEXT NOT NULL, -- 'above' or 'below'
          is_active BOOLEAN DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          triggered_at DATETIME,
          FOREIGN KEY (user_id) REFERENCES users (id)
        )
      `);

      // Paper trading portfolio table
      db.run(`
        CREATE TABLE IF NOT EXISTS portfolio (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          symbol TEXT NOT NULL,
          shares INTEGER NOT NULL,
          purchase_price DECIMAL(10,2) NOT NULL,
          purchase_date DATETIME DEFAULT CURRENT_TIMESTAMP,
          is_sold BOOLEAN DEFAULT 0,
          sold_price DECIMAL(10,2),
          sold_date DATETIME,
          FOREIGN KEY (user_id) REFERENCES users (id)
        )
      `);

      // Stock prices cache table
      db.run(`
        CREATE TABLE IF NOT EXISTS stock_prices (
          symbol TEXT PRIMARY KEY,
          price DECIMAL(10,2) NOT NULL,
          last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  });
};

// Helper functions for database operations
const dbHelpers = {
  // Get user by email
  getUserByEmail: (email) => {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },

  // Create new user
  createUser: (email, passwordHash) => {
    return new Promise((resolve, reject) => {
      db.run('INSERT INTO users (email, password_hash) VALUES (?, ?)', 
        [email, passwordHash], function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        });
    });
  },

  // Get user alerts
  getUserAlerts: (userId) => {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM price_alerts WHERE user_id = ? AND is_active = 1', 
        [userId], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
    });
  },

  // Create price alert
  createAlert: (userId, symbol, targetPrice, alertType) => {
    return new Promise((resolve, reject) => {
      db.run(`INSERT INTO price_alerts (user_id, symbol, target_price, alert_type) 
              VALUES (?, ?, ?, ?)`, 
        [userId, symbol, targetPrice, alertType], function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        });
    });
  },

  // Get all active alerts
  getAllActiveAlerts: () => {
    return new Promise((resolve, reject) => {
      db.all(`SELECT pa.*, u.email 
              FROM price_alerts pa 
              JOIN users u ON pa.user_id = u.id 
              WHERE pa.is_active = 1`, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },

  // Trigger alert
  triggerAlert: (alertId) => {
    return new Promise((resolve, reject) => {
      db.run(`UPDATE price_alerts 
              SET is_active = 0, triggered_at = CURRENT_TIMESTAMP 
              WHERE id = ?`, [alertId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  },

  // Get user portfolio
  getUserPortfolio: (userId) => {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM portfolio WHERE user_id = ?', [userId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },

  // Add to portfolio
  addToPortfolio: (userId, symbol, shares, purchasePrice) => {
    return new Promise((resolve, reject) => {
      db.run(`INSERT INTO portfolio (user_id, symbol, shares, purchase_price) 
              VALUES (?, ?, ?, ?)`, 
        [userId, symbol, shares, purchasePrice], function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        });
    });
  },

  // Update stock price
  updateStockPrice: (symbol, price) => {
    return new Promise((resolve, reject) => {
      db.run(`INSERT OR REPLACE INTO stock_prices (symbol, price, last_updated) 
              VALUES (?, ?, CURRENT_TIMESTAMP)`, 
        [symbol, price], (err) => {
          if (err) reject(err);
          else resolve();
        });
    });
  },

  // Get stock price
  getStockPrice: (symbol) => {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM stock_prices WHERE symbol = ?', [symbol], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }
};

module.exports = { db, initializeDB, dbHelpers };