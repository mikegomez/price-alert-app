const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { initializeDB } = require('./database/db');
const { router: authRoutes } = require('./routes/auth');

const alertRoutes = require('./routes/alerts');
const portfolioRoutes = require('./routes/portfolio');
const stockRoutes = require('./routes/stocks');

// Import price checking service
const { startPriceChecker, startKeepAlive } = require('./services/priceChecker');

const app = express();
const PORT = process.env.PORT || 3001;

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://cryptotrackeralerts.net',
  'https://cryptotrackeralerts.net',
  'http://www.cryptotrackeralerts.net',
  'https://www.cryptotrackeralerts.net'
];

// Middleware
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // Reject without throwing - an Error here becomes an uncaught 500
      // instead of a clean CORS block.
      callback(null, false);
    }
  },
  credentials: true,
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/stocks', stockRoutes);

// ✅ Add this just before the health check or right after the API routes:
app.get('/', (req, res) => {
  res.send('API server is running. Try /api/health or /api/alerts');
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Serve React app in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'build')));
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
  });
}

// Initialize database and start server
const startServer = async () => {
  try {
    await initializeDB();
    console.log('Database initialized successfully');
    
    // Start price checking service
    startPriceChecker();
    console.log('Price checking service started');

    // Prevent Render.com free tier cold starts
    startKeepAlive();
    
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();