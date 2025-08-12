const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto'); // ADD THIS MISSING IMPORT
const { dbHelpers } = require('../database/db');
const { sendWelcomeEmail, sendPasswordResetEmail } = require('../services/emailService'); // ADD sendPasswordResetEmail

const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || 'https://price-alert-app-xx8m.onrender.com';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

// Register endpoint
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if user already exists
    const existingUser = await dbHelpers.getUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create user
    const userId = await dbHelpers.createUser(email, passwordHash);

    // Generate JWT token
    const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '24h' });

    // Send welcome email
    await sendWelcomeEmail(email);

    res.status(201).json({
      message: 'User created successfully',
      token,
      user: { id: userId, email }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login endpoint
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const user = await dbHelpers.getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check password
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });

    res.json({
      message: 'Login successful',
      token,
      user: { id: user.id, email: user.email }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Get current user
router.get('/me', verifyToken, async (req, res) => {
  try {
    const user = await dbHelpers.getUserByEmail(req.user.email);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        created_at: user.created_at
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/resend-email', async (req, res) => {
  const { email } = req.body;

  if (!email) return res.status(400).json({ error: 'Email is required' });

  const user = await dbHelpers.getUserByEmail(email);
  if (!user) return res.status(404).json({ error: 'User not found' });

  try {
    await sendWelcomeEmail(email);
    res.json({ message: 'Welcome email resent successfully' });
  } catch (err) {
    console.error('Email resend error:', err);
    res.status(500).json({ error: 'Failed to resend email' });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await dbHelpers.getUserByEmail(email);
    // Always return 200 to avoid leaking which emails exist
    if (!user) return res.json({ message: 'If that email exists, a reset link has been sent.' });

    // Generate secure token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // +1 hour

    await dbHelpers.createPasswordReset(user.id, tokenHash, expiresAt);

    // Link back to your existing Login page but with token in query
    const resetUrl = `${FRONTEND_BASE_URL}/login?token=${encodeURIComponent(rawToken)}`;

    await sendPasswordResetEmail(email, resetUrl);

    return res.json({ message: 'If that email exists, a reset link has been sent.' });
  } catch (err) {
    console.error('forgot-password error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and new password are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const resetRow = await dbHelpers.getPasswordResetByHash(tokenHash);
    if (!resetRow) return res.status(400).json({ error: 'Invalid or expired reset token' });

    // Update password
    const saltRounds = 10;
    const newHash = await bcrypt.hash(password, saltRounds);
    await dbHelpers.updateUserPasswordHash(resetRow.user_id, newHash);

    // Delete reset row
    await dbHelpers.deletePasswordResetById(resetRow.id);

    return res.json({ message: 'Password has been reset successfully. You can now log in.' });
  } catch (err) {
    console.error('reset-password error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = {
  router,
  verifyToken
};


// const express = require('express');
// const bcrypt = require('bcrypt');
// const jwt = require('jsonwebtoken');
// const { dbHelpers } = require('../database/db');
// const { sendWelcomeEmail, sendPasswordResetEmail } = require('../services/emailService');

// const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || 'https://price-alert-app-xx8m.onrender.com';

// const crypto = require('crypto');

// const router = express.Router();
// const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

// // Register endpoint
// router.post('/register', async (req, res) => {
//   try {
//     const { email, password } = req.body;

//     // Validate input
//     if (!email || !password) {
//       return res.status(400).json({ error: 'Email and password are required' });
//     }

//     if (password.length < 6) {
//       return res.status(400).json({ error: 'Password must be at least 6 characters' });
//     }

//     // Check if user already exists
//     const existingUser = await dbHelpers.getUserByEmail(email);
//     if (existingUser) {
//       return res.status(400).json({ error: 'User already exists' });
//     }

//     // Hash password
//     const saltRounds = 10;
//     const passwordHash = await bcrypt.hash(password, saltRounds);

//     // Create user
//     const userId = await dbHelpers.createUser(email, passwordHash);

//     // Generate JWT token
//     const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '24h' });

//     // Send welcome email
//     await sendWelcomeEmail(email);

//     res.status(201).json({
//       message: 'User created successfully',
//       token,
//       user: { id: userId, email }
//     });
//   } catch (error) {
//     console.error('Registration error:', error);
//     res.status(500).json({ error: 'Internal server error' });
//   }
// });

// // Login endpoint
// router.post('/login', async (req, res) => {
//   try {
//     const { email, password } = req.body;

//     // Validate input
//     if (!email || !password) {
//       return res.status(400).json({ error: 'Email and password are required' });
//     }

//     // Find user
//     const user = await dbHelpers.getUserByEmail(email);
//     if (!user) {
//       return res.status(401).json({ error: 'Invalid credentials' });
//     }

//     // Check password
//     const passwordMatch = await bcrypt.compare(password, user.password_hash);
//     if (!passwordMatch) {
//       return res.status(401).json({ error: 'Invalid credentials' });
//     }

//     // Generate JWT token
//     const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });

//     res.json({
//       message: 'Login successful',
//       token,
//       user: { id: user.id, email: user.email }
//     });
//   } catch (error) {
//     console.error('Login error:', error);
//     res.status(500).json({ error: 'Internal server error' });
//   }
// });

// // Middleware to verify JWT token
// const verifyToken = (req, res, next) => {
//   const token = req.header('Authorization')?.replace('Bearer ', '');

//   if (!token) {
//     return res.status(401).json({ error: 'No token provided' });
//   }

//   try {
//     const decoded = jwt.verify(token, JWT_SECRET);
//     req.user = decoded;
//     next();
//   } catch (error) {
//     res.status(401).json({ error: 'Invalid token' });
//   }
// };

// // Get current user
// router.get('/me', verifyToken, async (req, res) => {
//   try {
//     const user = await dbHelpers.getUserByEmail(req.user.email);
//     if (!user) {
//       return res.status(404).json({ error: 'User not found' });
//     }

//     res.json({
//       user: {
//         id: user.id,
//         email: user.email,
//         created_at: user.created_at
//       }
//     });
//   } catch (error) {
//     console.error('Get user error:', error);
//     res.status(500).json({ error: 'Internal server error' });
//   }
// });

// router.post('/resend-email', async (req, res) => {
//   const { email } = req.body;

//   if (!email) return res.status(400).json({ error: 'Email is required' });

//   const user = await dbHelpers.getUserByEmail(email);
//   if (!user) return res.status(404).json({ error: 'User not found' });

//   try {
//     await sendWelcomeEmail(email);
//     res.json({ message: 'Welcome email resent successfully' });
//   } catch (err) {
//     console.error('Email resend error:', err);
//     res.status(500).json({ error: 'Failed to resend email' });
//   }
// });

// // POST /api/auth/forgot-password
// router.post('/forgot-password', async (req, res) => {
//   try {
//     const { email } = req.body;
//     if (!email) return res.status(400).json({ error: 'Email is required' });

//     const user = await dbHelpers.getUserByEmail(email);
//     // Always return 200 to avoid leaking which emails exist
//     if (!user) return res.json({ message: 'If that email exists, a reset link has been sent.' });

//     // Generate secure token
//     const rawToken = crypto.randomBytes(32).toString('hex');
//     const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
//     const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // +1 hour

//     await dbHelpers.createPasswordReset(user.id, tokenHash, expiresAt);

//     // Link back to your existing Login page but with token in query
//     const resetUrl = `${FRONTEND_BASE_URL}/login?token=${encodeURIComponent(rawToken)}`;

//     await sendPasswordResetEmail(email, resetUrl);

//     return res.json({ message: 'If that email exists, a reset link has been sent.' });
//   } catch (err) {
//     console.error('forgot-password error:', err);
//     return res.status(500).json({ error: 'Internal server error' });
//   }
// });

// // POST /api/auth/reset-password
// router.post('/reset-password', async (req, res) => {
//   try {
//     const { token, password } = req.body;
//     if (!token || !password) return res.status(400).json({ error: 'Token and new password are required' });
//     if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

//     const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

//     const resetRow = await dbHelpers.getPasswordResetByHash(tokenHash);
//     if (!resetRow) return res.status(400).json({ error: 'Invalid or expired reset token' });

//     // Update password
//     const saltRounds = 10;
//     const newHash = await bcrypt.hash(password, saltRounds);
//     await dbHelpers.updateUserPasswordHash(resetRow.user_id, newHash);

//     // Delete reset row
//     await dbHelpers.deletePasswordResetById(resetRow.id);

//     return res.json({ message: 'Password has been reset successfully. You can now log in.' });
//   } catch (err) {
//     console.error('reset-password error:', err);
//     return res.status(500).json({ error: 'Internal server error' });
//   }
// });

// module.exports = {
//   router,
//   verifyToken
// };
