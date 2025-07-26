const express = require('express');
const { dbHelpers } = require('../database/db');
const { verifyToken } = require('./auth');
const { getCryptoPrice } = require('../services/priceChecker');

const router = express.Router();

// Get user's portfolio with current values
router.get('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const portfolio = await dbHelpers.getUserPortfolio(userId);
    
    // Calculate current values and P&L
    const portfolioWithValues = await Promise.all(
      portfolio.map(async (position) => {
        try {
          const currentPrice = await getCryptoPrice(position.symbol);
          const currentValue = position.shares * currentPrice;
          const purchaseValue = position.shares * position.purchase_price;
          const unrealizedPnL = currentValue - purchaseValue;
          const unrealizedPnLPercent = (unrealizedPnL / purchaseValue) * 100;
          
          let realizedPnL = 0;
          let realizedPnLPercent = 0;
          
          if (position.is_sold) {
            const soldValue = position.shares * position.sold_price;
            realizedPnL = soldValue - purchaseValue;
            realizedPnLPercent = (realizedPnL / purchaseValue) * 100;
          }
          
          return {
            ...position,
            currentPrice: currentPrice,
            currentValue: position.is_sold ? position.shares * position.sold_price : currentValue,
            purchaseValue: purchaseValue,
            unrealizedPnL: position.is_sold ? 0 : unrealizedPnL,
            unrealizedPnLPercent: position.is_sold ? 0 : unrealizedPnLPercent,
            realizedPnL: realizedPnL,
            realizedPnLPercent: realizedPnLPercent,
            totalPnL: position.is_sold ? realizedPnL : unrealizedPnL,
            totalPnLPercent: position.is_sold ? realizedPnLPercent : unrealizedPnLPercent
          };
        } catch (error) {
          console.error(`Error fetching price for ${position.symbol}:`, error);
          return {
            ...position,
            currentPrice: null,
            currentValue: null,
            unrealizedPnL: null,
            unrealizedPnLPercent: null,
            error: 'Price unavailable'
          };
        }
      })
    );
    
    // Calculate portfolio totals
    const totalInvested = portfolioWithValues.reduce((sum, pos) => sum + pos.purchaseValue, 0);
    const totalCurrentValue = portfolioWithValues.reduce((sum, pos) => {
      return sum + (pos.currentValue || pos.purchaseValue);
    }, 0);
    const totalPnL = totalCurrentValue - totalInvested;
    const totalPnLPercent = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;
    
    res.json({
      portfolio: portfolioWithValues,
      summary: {
        totalInvested: totalInvested,
        totalCurrentValue: totalCurrentValue,
        totalPnL: totalPnL,
        totalPnLPercent: totalPnLPercent,
        totalPositions: portfolio.length,
        activePositions: portfolio.filter(p => !p.is_sold).length,
        soldPositions: portfolio.filter(p => p.is_sold).length
      }
    });
    
  } catch (error) {
    console.error('Error fetching portfolio:', error);
    res.status(500).json({ error: 'Failed to fetch portfolio' });
  }
});

// Buy crypto (add to portfolio)
router.post('/buy', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { symbol, shares, purchasePrice } = req.body;
    
    // Validate input
    if (!symbol || !shares || !purchasePrice) {
      return res.status(400).json({ 
        error: 'Symbol, shares, and purchasePrice are required' 
      });
    }
    
    if (shares <= 0) {
      return res.status(400).json({ 
        error: 'Shares must be greater than 0' 
      });
    }
    
    if (purchasePrice <= 0) {
      return res.status(400).json({ 
        error: 'Purchase price must be greater than 0' 
      });
    }
    
    // Validate that the cryptocurrency exists
    try {
      await getCryptoPrice(symbol);
    } catch (error) {
      return res.status(400).json({ 
        error: `Cryptocurrency ${symbol} not found` 
      });
    }
    
    // Add to portfolio
    const positionId = await dbHelpers.addToPortfolio(
      userId, 
      symbol.toUpperCase(), 
      shares, 
      purchasePrice
    );
    
    res.status(201).json({
      message: 'Position added to portfolio successfully',
      positionId: positionId,
      position: {
        id: positionId,
        symbol: symbol.toUpperCase(),
        shares: shares,
        purchasePrice: purchasePrice,
        purchaseValue: shares * purchasePrice,
        purchaseDate: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('Error adding to portfolio:', error);
    res.status(500).json({ error: 'Failed to add position to portfolio' });
  }
});

// Sell crypto (mark position as sold)
router.post('/sell/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const positionId = req.params.id;
    const { soldPrice } = req.body;
    
    // Validate input
    if (!soldPrice || soldPrice <= 0) {
      return res.status(400).json({ 
        error: 'soldPrice is required and must be greater than 0' 
      });
    }
    
    // Check if position exists and belongs to user
    const portfolio = await dbHelpers.getUserPortfolio(userId);
    const position = portfolio.find(p => p.id == positionId && !p.is_sold);
    
    if (!position) {
      return res.status(404).json({ 
        error: 'Position not found or already sold' 
      });
    }
    
    // Mark position as sold
    await new Promise((resolve, reject) => {
      require('../database/db').db.run(
        `UPDATE portfolio 
         SET is_sold = 1, sold_price = ?, sold_date = CURRENT_TIMESTAMP 
         WHERE id = ? AND user_id = ?`,
        [soldPrice, positionId, userId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
    
    // Calculate P&L
    const purchaseValue = position.shares * position.purchase_price;
    const soldValue = position.shares * soldPrice;
    const realizedPnL = soldValue - purchaseValue;
    const realizedPnLPercent = (realizedPnL / purchaseValue) * 100;
    
    res.json({
      message: 'Position sold successfully',
      sale: {
        positionId: positionId,
        symbol: position.symbol,
        shares: position.shares,
        purchasePrice: position.purchase_price,
        soldPrice: soldPrice,
        purchaseValue: purchaseValue,
        soldValue: soldValue,
        realizedPnL: realizedPnL,
        realizedPnLPercent: realizedPnLPercent,
        soldDate: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('Error selling position:', error);
    res.status(500).json({ error: 'Failed to sell position' });
  }
});

// Get portfolio performance over time
router.get('/performance', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const days = Math.min(parseInt(req.query.days) || 30, 365);
    
    const portfolio = await dbHelpers.getUserPortfolio(userId);
    
    // Group by symbol and calculate performance
    const symbolPerformance = {};
    
    for (const position of portfolio) {
      if (!symbolPerformance[position.symbol]) {
        symbolPerformance[position.symbol] = {
          symbol: position.symbol,
          totalShares: 0,
          totalInvested: 0,
          averagePurchasePrice: 0,
          positions: []
        };
      }
      
      const perf = symbolPerformance[position.symbol];
      perf.totalShares += position.shares;
      perf.totalInvested += position.shares * position.purchase_price;
      perf.positions.push(position);
    }
    
    // Calculate average purchase price and current performance
    const performanceData = await Promise.all(
      Object.values(symbolPerformance).map(async (perf) => {
        perf.averagePurchasePrice = perf.totalInvested / perf.totalShares;
        
        try {
          const currentPrice = await getCryptoPrice(perf.symbol);
          const currentValue = perf.totalShares * currentPrice;
          const totalPnL = currentValue - perf.totalInvested;
          const totalPnLPercent = (totalPnL / perf.totalInvested) * 100;
          
          return {
            ...perf,
            currentPrice: currentPrice,
            currentValue: currentValue,
            totalPnL: totalPnL,
            totalPnLPercent: totalPnLPercent
          };
        } catch (error) {
          return {
            ...perf,
            currentPrice: null,
            currentValue: null,
            totalPnL: null,
            totalPnLPercent: null,
            error: 'Price unavailable'
          };
        }
      })
    );
    
    res.json({ 
      performance: performanceData,
      period: `${days} days`
    });
    
  } catch (error) {
    console.error('Error fetching portfolio performance:', error);
    res.status(500).json({ error: 'Failed to fetch portfolio performance' });
  }
});

// Get trading history
router.get('/history', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    
    const history = await new Promise((resolve, reject) => {
      require('../database/db').db.all(
        `SELECT * FROM portfolio 
         WHERE user_id = ? 
         ORDER BY purchase_date DESC 
         LIMIT ?`,
        [userId, limit],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
    
    // Add P&L calculations to history
    const historyWithPnL = history.map(trade => {
      const purchaseValue = trade.shares * trade.purchase_price;
      let realizedPnL = 0;
      let realizedPnLPercent = 0;
      
      if (trade.is_sold) {
        const soldValue = trade.shares * trade.sold_price;
        realizedPnL = soldValue - purchaseValue;
        realizedPnLPercent = (realizedPnL / purchaseValue) * 100;
      }
      
      return {
        ...trade,
        purchaseValue: purchaseValue,
        realizedPnL: realizedPnL,
        realizedPnLPercent: realizedPnLPercent,
        status: trade.is_sold ? 'sold' : 'active'
      };
    });
    
    res.json({ 
      history: historyWithPnL,
      total: history.length
    });
    
  } catch (error) {
    console.error('Error fetching trading history:', error);
    res.status(500).json({ error: 'Failed to fetch trading history' });
  }
});

// Delete a position (only if not sold)
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const positionId = req.params.id;
    
    // Check if position exists and belongs to user
    const portfolio = await dbHelpers.getUserPortfolio(userId);
    const position = portfolio.find(p => p.id == positionId);
    
    if (!position) {
      return res.status(404).json({ error: 'Position not found' });
    }
    
    if (position.is_sold) {
      return res.status(400).json({ 
        error: 'Cannot delete sold positions. They are part of your trading history.' 
      });
    }
    
    // Delete the position
    await new Promise((resolve, reject) => {
      require('../database/db').db.run(
        'DELETE FROM portfolio WHERE id = ? AND user_id = ?',
        [positionId, userId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
    
    res.json({ message: 'Position deleted successfully' });
    
  } catch (error) {
    console.error('Error deleting position:', error);
    res.status(500).json({ error: 'Failed to delete position' });
  }
});

module.exports = router;