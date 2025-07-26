const express = require('express');
const axios = require('axios');
const { dbHelpers } = require('../database/db');
const { verifyToken } = require('./auth');
const { getCryptoPrice } = require('../services/priceChecker');

const router = express.Router();
const COINGECKO_API_BASE = 'https://api.coingecko.com/api/v3';

// Get current price for a crypto
router.get('/price/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    
    // Check if we have recent cached price first
    const cachedPrice = await dbHelpers.getStockPrice(symbol.toUpperCase());
    
    // If cached price is less than 5 minutes old, use it
    if (cachedPrice) {
      const cacheAge = Date.now() - new Date(cachedPrice.last_updated).getTime();
      if (cacheAge < 5 * 60 * 1000) { // 5 minutes
        return res.json({
          symbol: symbol.toUpperCase(),
          price: cachedPrice.price,
          cached: true,
          lastUpdated: cachedPrice.last_updated
        });
      }
    }
    
    // Get fresh price
    const price = await getCryptoPrice(symbol);
    
    // Update cache
    await dbHelpers.updateStockPrice(symbol.toUpperCase(), price);
    
    res.json({
      symbol: symbol.toUpperCase(),
      price: price,
      cached: false,
      lastUpdated: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error fetching crypto price:', error);
    res.status(404).json({ error: `Cryptocurrency ${req.params.symbol} not found` });
  }
});

// Get multiple crypto prices
router.post('/prices', async (req, res) => {
  try {
    const { symbols } = req.body;
    
    if (!Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({ error: 'Symbols array is required' });
    }
    
    if (symbols.length > 10) {
      return res.status(400).json({ error: 'Maximum 10 symbols allowed' });
    }
    
    const prices = {};
    
    for (const symbol of symbols) {
      try {
        const price = await getCryptoPrice(symbol);
        prices[symbol.toUpperCase()] = {
          price: price,
          lastUpdated: new Date().toISOString()
        };
        
        // Update cache
        await dbHelpers.updateStockPrice(symbol.toUpperCase(), price);
        
        // Rate limiting delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        prices[symbol.toUpperCase()] = {
          error: error.message
        };
      }
    }
    
    res.json(prices);
    
  } catch (error) {
    console.error('Error fetching multiple prices:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Search for cryptocurrencies
router.get('/search/:query', async (req, res) => {
  try {
    const { query } = req.params;
    
    if (!query || query.length < 2) {
      return res.status(400).json({ error: 'Query must be at least 2 characters' });
    }
    
    const response = await axios.get(`${COINGECKO_API_BASE}/search`, {
      params: { query: query }
    });
    
    // Format the response to include relevant crypto info
    const cryptos = response.data.coins.slice(0, 20).map(coin => ({
      id: coin.id,
      name: coin.name,
      symbol: coin.symbol.toUpperCase(),
      marketCapRank: coin.market_cap_rank,
      thumb: coin.thumb
    }));
    
    res.json({ cryptos });
    
  } catch (error) {
    console.error('Error searching cryptocurrencies:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Get trending cryptocurrencies
router.get('/trending', async (req, res) => {
  try {
    const response = await axios.get(`${COINGECKO_API_BASE}/search/trending`);
    
    const trending = response.data.coins.map(item => ({
      id: item.item.id,
      name: item.item.name,
      symbol: item.item.symbol.toUpperCase(),
      marketCapRank: item.item.market_cap_rank,
      thumb: item.item.thumb,
      priceChangePercentage24h: item.item.price_change_percentage_24h
    }));
    
    res.json({ trending });
    
  } catch (error) {
    console.error('Error fetching trending cryptos:', error);
    res.status(500).json({ error: 'Failed to fetch trending cryptocurrencies' });
  }
});

// Get top cryptocurrencies by market cap
router.get('/top/:limit?', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.params.limit) || 50, 100);
    
    const response = await axios.get(`${COINGECKO_API_BASE}/coins/markets`, {
      params: {
        vs_currency: 'usd',
        order: 'market_cap_desc',
        per_page: limit,
        page: 1,
        sparkline: false
      }
    });
    
    const topCryptos = response.data.map(coin => ({
      id: coin.id,
      name: coin.name,
      symbol: coin.symbol.toUpperCase(),
      currentPrice: coin.current_price,
      marketCap: coin.market_cap,
      marketCapRank: coin.market_cap_rank,
      priceChangePercentage24h: coin.price_change_percentage_24h,
      image: coin.image
    }));
    
    res.json({ cryptos: topCryptos });
    
  } catch (error) {
    console.error('Error fetching top cryptos:', error);
    res.status(500).json({ error: 'Failed to fetch top cryptocurrencies' });
  }
});

// Get crypto details and price history
router.get('/details/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    
    // First search for the crypto to get its CoinGecko ID
    const searchResponse = await axios.get(`${COINGECKO_API_BASE}/search`, {
      params: { query: symbol }
    });
    
    const coin = searchResponse.data.coins.find(c => 
      c.symbol.toUpperCase() === symbol.toUpperCase()
    );
    
    if (!coin) {
      return res.status(404).json({ error: `Cryptocurrency ${symbol} not found` });
    }
    
    // Get detailed info
    const detailsResponse = await axios.get(`${COINGECKO_API_BASE}/coins/${coin.id}`, {
      params: {
        localization: false,
        tickers: false,
        market_data: true,
        community_data: false,
        developer_data: false,
        sparkline: false
      }
    });
    
    const coinData = detailsResponse.data;
    
    const details = {
      id: coinData.id,
      name: coinData.name,
      symbol: coinData.symbol.toUpperCase(),
      description: coinData.description.en.split('.')[0] + '.', // First sentence only
      image: coinData.image.large,
      currentPrice: coinData.market_data.current_price.usd,
      marketCap: coinData.market_data.market_cap.usd,
      marketCapRank: coinData.market_cap_rank,
      totalVolume: coinData.market_data.total_volume.usd,
      priceChangePercentage24h: coinData.market_data.price_change_percentage_24h,
      priceChangePercentage7d: coinData.market_data.price_change_percentage_7d,
      priceChangePercentage30d: coinData.market_data.price_change_percentage_30d,
      allTimeHigh: coinData.market_data.ath.usd,
      allTimeLow: coinData.market_data.atl.usd,
      circulatingSupply: coinData.market_data.circulating_supply,
      totalSupply: coinData.market_data.total_supply,
      maxSupply: coinData.market_data.max_supply
    };
    
    res.json(details);
    
  } catch (error) {
    console.error('Error fetching crypto details:', error);
    res.status(500).json({ error: 'Failed to fetch cryptocurrency details' });
  }
});

// Get price history for charts
router.get('/history/:symbol/:days?', async (req, res) => {
  try {
    const { symbol, days = 7 } = req.params;
    const validDays = Math.min(parseInt(days) || 7, 365);
    
    // Search for the crypto to get its CoinGecko ID
    const searchResponse = await axios.get(`${COINGECKO_API_BASE}/search`, {
      params: { query: symbol }
    });
    
    const coin = searchResponse.data.coins.find(c => 
      c.symbol.toUpperCase() === symbol.toUpperCase()
    );
    
    if (!coin) {
      return res.status(404).json({ error: `Cryptocurrency ${symbol} not found` });
    }
    
    // Get price history
    const historyResponse = await axios.get(`${COINGECKO_API_BASE}/coins/${coin.id}/market_chart`, {
      params: {
        vs_currency: 'usd',
        days: validDays,
        interval: validDays <= 1 ? 'hourly' : 'daily'
      }
    });
    
    const priceHistory = historyResponse.data.prices.map(([timestamp, price]) => ({
      timestamp: new Date(timestamp).toISOString(),
      price: price
    }));
    
    res.json({
      symbol: symbol.toUpperCase(),
      days: validDays,
      history: priceHistory
    });
    
  } catch (error) {
    console.error('Error fetching price history:', error);
    res.status(500).json({ error: 'Failed to fetch price history' });
  }
});

// Get user's watchlist (cached prices for quick access)
router.get('/watchlist', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Get user's alerts to determine watchlist
    const alerts = await dbHelpers.getUserAlerts(userId);
    const portfolio = await dbHelpers.getUserPortfolio(userId);
    
    // Get unique symbols from alerts and portfolio
    const symbols = new Set();
    alerts.forEach(alert => symbols.add(alert.symbol));
    portfolio.forEach(position => symbols.add(position.symbol));
    
    const watchlist = {};
    
    for (const symbol of symbols) {
      const cachedPrice = await dbHelpers.getStockPrice(symbol);
      if (cachedPrice) {
        watchlist[symbol] = {
          price: cachedPrice.price,
          lastUpdated: cachedPrice.last_updated
        };
      }
    }
    
    res.json({ watchlist });
    
  } catch (error) {
    console.error('Error fetching watchlist:', error);
    res.status(500).json({ error: 'Failed to fetch watchlist' });
  }
});

module.exports = router;