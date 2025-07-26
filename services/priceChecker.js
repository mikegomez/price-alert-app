const cron = require('node-cron');
const axios = require('axios');
const { dbHelpers } = require('../database/db');
const { sendAlertEmail } = require('./emailService');

// CoinGecko API - Free tier allows 10-50 calls per minute
const COINGECKO_API_BASE = 'https://api.coingecko.com/api/v3';

// Common crypto symbol mappings (symbol -> CoinGecko ID)
const CRYPTO_ID_MAP = {
  'BTC': 'bitcoin',
  'ETH': 'ethereum',
  'BNB': 'binancecoin',
  'XRP': 'ripple',
  'ADA': 'cardano',
  'DOGE': 'dogecoin',
  'SOL': 'solana',
  'DOT': 'polkadot',
  'AVAX': 'avalanche-2',
  'LINK': 'chainlink',
  'MATIC': 'matic-network',
  'UNI': 'uniswap',
  'ATOM': 'cosmos',
  'LTC': 'litecoin',
  'BCH': 'bitcoin-cash'
};

// Get crypto price from CoinGecko
const getCryptoPrice = async (symbol) => {
  try {
    const normalizedSymbol = symbol.toUpperCase();
    
    // Convert symbol to CoinGecko ID
    const coinId = CRYPTO_ID_MAP[normalizedSymbol];
    
    if (!coinId) {
      // Try to find the coin ID dynamically
      const searchResponse = await axios.get(`${COINGECKO_API_BASE}/search`, {
        params: { query: symbol }
      });
      
      const coin = searchResponse.data.coins.find(c => 
        c.symbol.toUpperCase() === normalizedSymbol
      );
      
      if (!coin) {
        throw new Error(`Cryptocurrency ${symbol} not found`);
      }
      
      // Use the found coin ID
      const foundCoinId = coin.id;
      
      // Get price using the found ID
      const priceResponse = await axios.get(`${COINGECKO_API_BASE}/simple/price`, {
        params: {
          ids: foundCoinId,
          vs_currencies: 'usd'
        }
      });
      
      const price = priceResponse.data[foundCoinId]?.usd;
      if (!price) {
        throw new Error(`No price data for ${symbol}`);
      }
      
      return price;
    }
    
    // Get price using known coin ID
    const response = await axios.get(`${COINGECKO_API_BASE}/simple/price`, {
      params: {
        ids: coinId,
        vs_currencies: 'usd'
      }
    });

    const price = response.data[coinId]?.usd;
    if (!price) {
      throw new Error(`No price data for ${symbol}`);
    }

    return price;
  } catch (error) {
    console.error(`Error fetching price for ${symbol}:`, error.message);
    
    // Return mock data for development
    if (process.env.NODE_ENV === 'development') {
      // Return realistic crypto prices for testing
      const mockPrices = {
        'BTC': 45000 + Math.random() * 10000,
        'ETH': 2500 + Math.random() * 1000,
        'BNB': 300 + Math.random() * 100,
        'ADA': 0.5 + Math.random() * 0.5,
        'DOGE': 0.1 + Math.random() * 0.1
      };
      
      return mockPrices[symbol.toUpperCase()] || Math.random() * 100;
    }
    
    throw error;
  }
};

// Check all active alerts
const checkPriceAlerts = async () => {
  try {
    console.log('Checking price alerts...');
    
    const alerts = await dbHelpers.getAllActiveAlerts();
    
    if (alerts.length === 0) {
      console.log('No active alerts to check');
      return;
    }

    // Group alerts by symbol to minimize API calls
    const symbolGroups = {};
    alerts.forEach(alert => {
      if (!symbolGroups[alert.symbol]) {
        symbolGroups[alert.symbol] = [];
      }
      symbolGroups[alert.symbol].push(alert);
    });

    // Check each symbol
    for (const [symbol, symbolAlerts] of Object.entries(symbolGroups)) {
      try {
        const currentPrice = await getCryptoPrice(symbol);
        
        // Update price in database
        await dbHelpers.updateStockPrice(symbol, currentPrice);
        
        console.log(`${symbol}: $${currentPrice}`);

        // Check each alert for this symbol
        for (const alert of symbolAlerts) {
          let shouldTrigger = false;
          
          if (alert.alert_type === 'above' && currentPrice >= alert.target_price) {
            shouldTrigger = true;
          } else if (alert.alert_type === 'below' && currentPrice <= alert.target_price) {
            shouldTrigger = true;
          }

          if (shouldTrigger) {
            console.log(`Alert triggered for ${alert.email}: ${symbol} ${alert.alert_type} $${alert.target_price}`);
            
            // Send email notification
            await sendAlertEmail(
              alert.email,
              symbol,
              currentPrice,
              alert.target_price,
              alert.alert_type
            );
            
            // Mark alert as triggered
            await dbHelpers.triggerAlert(alert.id);
          }
        }

        // Add delay between API calls to avoid rate limiting (CoinGecko: 10-50 calls/minute)
        await new Promise(resolve => setTimeout(resolve, 2000));
        
      } catch (error) {
        console.error(`Error checking ${symbol}:`, error.message);
      }
    }
    
    console.log('Price alert check completed');
  } catch (error) {
    console.error('Error in price alert check:', error);
  }
};

// Start the price checking service
const startPriceChecker = () => {
  // Run every 5 minutes (crypto markets are 24/7)
  cron.schedule('*/5 * * * *', checkPriceAlerts);
  
  // For development, run every 2 minutes to respect rate limits
  if (process.env.NODE_ENV === 'development') {
    cron.schedule('*/2 * * * *', checkPriceAlerts);
  }
  
  console.log('Crypto price checker scheduled (24/7)');
};

module.exports = { startPriceChecker, getCryptoPrice, checkPriceAlerts };