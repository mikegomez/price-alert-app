const { Pool } = require('pg');

// Validate required environment variables
// Either a single DATABASE_URL (what Render Postgres provides), or the
// discrete DB_HOST/DB_USER/DB_PASSWORD/DB_NAME set.
const hasDiscreteVars = process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASSWORD && process.env.DB_NAME;
if (!process.env.DATABASE_URL && !hasDiscreteVars) {
  console.error('❌ Missing database configuration: set DATABASE_URL, or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME');
  process.exit(1);
}

// SSL is required for Render's external Postgres connection string, but not
// for its internal one. Set DB_SSL=true if connecting from outside Render.
const sslConfig = process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false;

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: sslConfig,
    })
  : new Pool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: parseInt(process.env.DB_PORT) || 5432,
      ssl: sslConfig,
    });

// Test database connection with detailed error reporting
const testConnection = async () => {
  try {
    console.log('Testing database connection...');
    const client = await pool.connect();
    console.log('✅ Database connection successful');

    await client.query('SELECT 1');
    console.log('✅ Database query test successful');

    client.release();
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:');
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
    return false;
  }
};

// Initialize database tables
const initializeDB = async () => {
  const connectionSuccess = await testConnection();
  if (!connectionSuccess) {
    console.error('Skipping database initialization due to connection failure');
    return false;
  }

  const client = await pool.connect();

  try {
    console.log('Initializing database tables...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS password_resets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash CHAR(64) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_password_resets_user_id ON password_resets(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_password_resets_token_hash ON password_resets(token_hash)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS price_alerts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        symbol VARCHAR(20) NOT NULL,
        target_price NUMERIC(15,8) NOT NULL,
        alert_type VARCHAR(10) NOT NULL CHECK (alert_type IN ('above', 'below')),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        triggered_at TIMESTAMP NULL
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_price_alerts_user_active ON price_alerts(user_id, is_active)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_price_alerts_symbol ON price_alerts(symbol)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_price_alerts_active ON price_alerts(is_active)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS portfolio (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        symbol VARCHAR(20) NOT NULL,
        shares NUMERIC(15,8) NOT NULL,
        purchase_price NUMERIC(15,8) NOT NULL,
        purchase_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_sold BOOLEAN DEFAULT FALSE,
        sold_price NUMERIC(15,8) NULL,
        sold_date TIMESTAMP NULL
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_portfolio_user_symbol ON portfolio(user_id, symbol)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_portfolio_user_active ON portfolio(user_id, is_sold)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS stock_prices (
        symbol VARCHAR(20) PRIMARY KEY,
        price NUMERIC(15,8) NOT NULL,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_stock_prices_updated ON stock_prices(last_updated)');

    console.log('✅ Database tables initialized successfully');
    return true;
  } catch (error) {
    console.error('❌ Error initializing database:', error);
    throw error;
  } finally {
    client.release();
  }
};

// Helper functions for database operations
const dbHelpers = {
  // Get user by email
  getUserByEmail: async (email) => {
    try {
      const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      return rows[0] || null;
    } catch (error) {
      console.error('Error getting user by email:', error);
      throw error;
    }
  },

  // Get user by ID
  getUserById: async (userId) => {
    try {
      const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
      return rows[0] || null;
    } catch (error) {
      console.error('Error getting user by ID:', error);
      throw error;
    }
  },

  // Create new user
  createUser: async (email, passwordHash) => {
    try {
      const { rows } = await pool.query(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id',
        [email, passwordHash]
      );
      return rows[0].id;
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    }
  },

  // Password Reset Functions
  createPasswordReset: async (userId, tokenHash, expiresAt) => {
    try {
      const { rows } = await pool.query(
        'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, $3) RETURNING id',
        [userId, tokenHash, expiresAt]
      );
      return rows[0].id;
    } catch (error) {
      console.error('Error creating password reset:', error);
      throw error;
    }
  },

  getPasswordResetByHash: async (tokenHash) => {
    try {
      const { rows } = await pool.query(
        'SELECT * FROM password_resets WHERE token_hash = $1 AND expires_at > NOW() LIMIT 1',
        [tokenHash]
      );
      return rows[0] || null;
    } catch (error) {
      console.error('Error getting password reset by hash:', error);
      throw error;
    }
  },

  deletePasswordResetById: async (id) => {
    try {
      const result = await pool.query('DELETE FROM password_resets WHERE id = $1', [id]);
      return result.rowCount > 0;
    } catch (error) {
      console.error('Error deleting password reset:', error);
      throw error;
    }
  },

  updateUserPasswordHash: async (userId, newHash) => {
    try {
      const result = await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, userId]);
      return result.rowCount > 0;
    } catch (error) {
      console.error('Error updating user password hash:', error);
      throw error;
    }
  },

  // Clean up expired password reset tokens
  cleanupExpiredResets: async () => {
    try {
      const result = await pool.query('DELETE FROM password_resets WHERE expires_at < NOW()');
      return result.rowCount;
    } catch (error) {
      console.error('Error cleaning up expired resets:', error);
      throw error;
    }
  },

  // Get user alerts
  getUserAlerts: async (userId) => {
    try {
      const { rows } = await pool.query(
        'SELECT * FROM price_alerts WHERE user_id = $1 AND is_active = TRUE ORDER BY created_at DESC',
        [userId]
      );
      return rows;
    } catch (error) {
      console.error('Error getting user alerts:', error);
      throw error;
    }
  },

  // Get one alert, scoped to its owner
  getAlertByIdAndUser: async (alertId, userId) => {
    try {
      const { rows } = await pool.query(
        'SELECT * FROM price_alerts WHERE id = $1 AND user_id = $2',
        [alertId, userId]
      );
      return rows[0] || null;
    } catch (error) {
      console.error('Error getting alert by id:', error);
      throw error;
    }
  },

  // Create price alert
  createAlert: async (userId, symbol, targetPrice, alertType) => {
    try {
      const { rows } = await pool.query(
        'INSERT INTO price_alerts (user_id, symbol, target_price, alert_type) VALUES ($1, $2, $3, $4) RETURNING id',
        [userId, symbol.toUpperCase(), parseFloat(targetPrice), alertType]
      );
      return rows[0].id;
    } catch (error) {
      console.error('Error creating alert:', error);
      throw error;
    }
  },

  // Update fields on an alert, scoped to its owner. updateData keys must
  // already be snake_case DB column names (target_price, alert_type, is_active).
  updateAlert: async (alertId, userId, updateData) => {
    const columns = Object.keys(updateData);
    if (columns.length === 0) return false;

    try {
      const setClause = columns.map((col, i) => `${col} = $${i + 1}`).join(', ');
      const values = columns.map((col) => updateData[col]);
      const result = await pool.query(
        `UPDATE price_alerts SET ${setClause} WHERE id = $${columns.length + 1} AND user_id = $${columns.length + 2}`,
        [...values, alertId, userId]
      );
      return result.rowCount > 0;
    } catch (error) {
      console.error('Error updating alert:', error);
      throw error;
    }
  },

  // Get all active alerts
  getAllActiveAlerts: async () => {
    try {
      const { rows } = await pool.query(`
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
      const result = await pool.query(
        'UPDATE price_alerts SET is_active = FALSE, triggered_at = NOW() WHERE id = $1',
        [alertId]
      );
      return result.rowCount > 0;
    } catch (error) {
      console.error('Error triggering alert:', error);
      throw error;
    }
  },

  // Delete alert
  deleteAlert: async (alertId, userId) => {
    try {
      const result = await pool.query(
        'DELETE FROM price_alerts WHERE id = $1 AND user_id = $2',
        [alertId, userId]
      );
      return result.rowCount > 0;
    } catch (error) {
      console.error('Error deleting alert:', error);
      throw error;
    }
  },

  // Get triggered alert history for a user
  getTriggeredAlertsHistory: async (userId) => {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM price_alerts
         WHERE user_id = $1 AND is_active = FALSE AND triggered_at IS NOT NULL
         ORDER BY triggered_at DESC`,
        [userId]
      );
      return rows;
    } catch (error) {
      console.error('Error getting triggered alerts history:', error);
      throw error;
    }
  },

  // Get user portfolio
  getUserPortfolio: async (userId) => {
    try {
      const { rows } = await pool.query(
        'SELECT * FROM portfolio WHERE user_id = $1 ORDER BY purchase_date DESC',
        [userId]
      );
      return rows;
    } catch (error) {
      console.error('Error getting user portfolio:', error);
      throw error;
    }
  },

  // Get trading history (most recent positions, active or sold)
  getPortfolioHistory: async (userId, limit) => {
    try {
      const { rows } = await pool.query(
        'SELECT * FROM portfolio WHERE user_id = $1 ORDER BY purchase_date DESC LIMIT $2',
        [userId, limit]
      );
      return rows;
    } catch (error) {
      console.error('Error getting portfolio history:', error);
      throw error;
    }
  },

  // Add to portfolio
  addToPortfolio: async (userId, symbol, shares, purchasePrice) => {
    try {
      const { rows } = await pool.query(
        'INSERT INTO portfolio (user_id, symbol, shares, purchase_price) VALUES ($1, $2, $3, $4) RETURNING id',
        [userId, symbol.toUpperCase(), parseFloat(shares), parseFloat(purchasePrice)]
      );
      return rows[0].id;
    } catch (error) {
      console.error('Error adding to portfolio:', error);
      throw error;
    }
  },

  // Sell from portfolio, scoped to its owner
  sellFromPortfolio: async (portfolioId, userId, soldPrice) => {
    try {
      const result = await pool.query(
        `UPDATE portfolio SET is_sold = TRUE, sold_price = $1, sold_date = NOW()
         WHERE id = $2 AND user_id = $3`,
        [parseFloat(soldPrice), portfolioId, userId]
      );
      return result.rowCount > 0;
    } catch (error) {
      console.error('Error selling from portfolio:', error);
      throw error;
    }
  },

  // Delete a portfolio position, scoped to its owner
  deletePortfolioPosition: async (portfolioId, userId) => {
    try {
      const result = await pool.query(
        'DELETE FROM portfolio WHERE id = $1 AND user_id = $2',
        [portfolioId, userId]
      );
      return result.rowCount > 0;
    } catch (error) {
      console.error('Error deleting portfolio position:', error);
      throw error;
    }
  },

  // Update stock price
  updateStockPrice: async (symbol, price) => {
    const parsed = parseFloat(price);
    if (!parsed || parsed <= 0) return; // never cache zero or invalid prices
    try {
      await pool.query(
        `INSERT INTO stock_prices (symbol, price, last_updated) VALUES ($1, $2, NOW())
         ON CONFLICT (symbol) DO UPDATE SET price = EXCLUDED.price, last_updated = NOW()`,
        [symbol.toUpperCase(), parsed]
      );
    } catch (error) {
      console.error('Error updating stock price:', error);
    }
  },

  // Get stock price
  getStockPrice: async (symbol) => {
    try {
      const { rows } = await pool.query('SELECT * FROM stock_prices WHERE symbol = $1', [symbol.toUpperCase()]);
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
      const upperSymbols = symbols.map((s) => s.toUpperCase());
      const { rows } = await pool.query(
        'SELECT * FROM stock_prices WHERE symbol = ANY($1)',
        [upperSymbols]
      );
      return rows;
    } catch (error) {
      console.error('Error getting stock prices:', error);
      return [];
    }
  },
};

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Closing Postgres connection pool...');
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Closing Postgres connection pool...');
  await pool.end();
  process.exit(0);
});

module.exports = { pool, initializeDB, dbHelpers, testConnection };
