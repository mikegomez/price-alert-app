const cron = require('node-cron');
const axios = require('axios');
const { dbHelpers } = require('../database/db');
const { sendAlertEmail } = require('./emailService');

// CoinGecko API - Free tier allows 10-50 calls per minute
const COINGECKO_API_BASE = 'https://api.coingecko.com/api/v3';

// Rate limiting - track API calls
let apiCallCount = 0;
let lastResetTime = Date.now();
const MAX_CALLS_PER_MINUTE = 10; // Conservative limit for free tier
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute in milliseconds

// In-memory cache for prices (fallback if database cache fails)
const priceCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes


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
// const getCryptoPrice = async (symbol) => {
//   try {
//     const normalizedSymbol = symbol.toUpperCase();
    
//     // Convert symbol to CoinGecko ID
//     const coinId = CRYPTO_ID_MAP[normalizedSymbol];
    
//     if (!coinId) {
//       // Try to find the coin ID dynamically
//       const searchResponse = await axios.get(`${COINGECKO_API_BASE}/search`, {
//         params: { query: symbol }
//       });
      
//       const coin = searchResponse.data.coins.find(c => 
//         c.symbol.toUpperCase() === normalizedSymbol
//       );
      
//       if (!coin) {
//         throw new Error(`Cryptocurrency ${symbol} not found`);
//       }
      
//       // Use the found coin ID
//       const foundCoinId = coin.id;
      
//       // Get price using the found ID
//       const priceResponse = await axios.get(`${COINGECKO_API_BASE}/simple/price`, {
//         params: {
//           ids: foundCoinId,
//           vs_currencies: 'usd'
//         }
//       });
      
//       const price = priceResponse.data[foundCoinId]?.usd;
//       if (!price) {
//         throw new Error(`No price data for ${symbol}`);
//       }
      
//       return price;
//     }
    
//     // Get price using known coin ID
//     const response = await axios.get(`${COINGECKO_API_BASE}/simple/price`, {
//       params: {
//         ids: coinId,
//         vs_currencies: 'usd'
//       }
//     });

//     const price = response.data[coinId]?.usd;
//     if (!price) {
//       throw new Error(`No price data for ${symbol}`);
//     }

//     return price;
//   } catch (error) {
//     console.error(`Error fetching price for ${symbol}:`, error.message);
    
//     // Return mock data for development
//     if (process.env.NODE_ENV === 'development') {
//       // Return realistic crypto prices for testing
//       const mockPrices = {
//         'BTC': 45000 + Math.random() * 10000,
//         'ETH': 2500 + Math.random() * 1000,
//         'BNB': 300 + Math.random() * 100,
//         'ADA': 0.5 + Math.random() * 0.5,
//         'DOGE': 0.1 + Math.random() * 0.1
//       };
      
//       return mockPrices[symbol.toUpperCase()] || Math.random() * 100;
//     }
    
//     throw error;
//   }
// };

// // Check all active alerts
// const checkPriceAlerts = async () => {
//   try {
//     console.log('Checking price alerts...');
    
//     const alerts = await dbHelpers.getAllActiveAlerts();
    
//     if (alerts.length === 0) {
//       console.log('No active alerts to check');
//       return;
//     }

//     // Group alerts by symbol to minimize API calls
//     const symbolGroups = {};
//     alerts.forEach(alert => {
//       if (!symbolGroups[alert.symbol]) {
//         symbolGroups[alert.symbol] = [];
//       }
//       symbolGroups[alert.symbol].push(alert);
//     });

//     // Check each symbol
//     for (const [symbol, symbolAlerts] of Object.entries(symbolGroups)) {
//       try {
//         const currentPrice = await getCryptoPrice(symbol);
        
//         // Update price in database
//         await dbHelpers.updateStockPrice(symbol, currentPrice);
        
//         console.log(`${symbol}: $${currentPrice}`);

//         // Check each alert for this symbol
//         for (const alert of symbolAlerts) {
//           let shouldTrigger = false;
          
//           if (alert.alert_type === 'above' && currentPrice >= alert.target_price) {
//             shouldTrigger = true;
//           } else if (alert.alert_type === 'below' && currentPrice <= alert.target_price) {
//             shouldTrigger = true;
//           }

//           if (shouldTrigger) {
//             console.log(`Alert triggered for ${alert.email}: ${symbol} ${alert.alert_type} $${alert.target_price}`);
            
//             // Send email notification
//             await sendAlertEmail(
//               alert.email,
//               symbol,
//               currentPrice,
//               alert.target_price,
//               alert.alert_type
//             );
            
//             // Mark alert as triggered
//             await dbHelpers.triggerAlert(alert.id);
//           }
//         }

//         // Add delay between API calls to avoid rate limiting (CoinGecko: 10-50 calls/minute)
//         await new Promise(resolve => setTimeout(resolve, 2000));
        
//       } catch (error) {
//         console.error(`Error checking ${symbol}:`, error.message);
//       }
//     }
    
//     console.log('Price alert check completed');
//   } catch (error) {
//     console.error('Error in price alert check:', error);
//   }
// };

// // Start the price checking service
// const startPriceChecker = () => {
//   // Run every 5 minutes (crypto markets are 24/7)
//   cron.schedule('*/5 * * * *', checkPriceAlerts);
  
//   // For development, run every 2 minutes to respect rate limits
//   if (process.env.NODE_ENV === 'development') {
//     cron.schedule('*/2 * * * *', checkPriceAlerts);
//   }
  
//   console.log('Crypto price checker scheduled (24/7)');
// };

// module.exports = { startPriceChecker, getCryptoPrice, checkPriceAlerts };




// Check if we can make an API call (rate limiting)
const canMakeApiCall = () => {
  const now = Date.now();
  
  // Reset counter every minute
  if (now - lastResetTime > RATE_LIMIT_WINDOW) {
    apiCallCount = 0;
    lastResetTime = now;
  }
  
  return apiCallCount < MAX_CALLS_PER_MINUTE;
};

// Wait until we can make an API call
const waitForRateLimit = async () => {
  while (!canMakeApiCall()) {
    const waitTime = RATE_LIMIT_WINDOW - (Date.now() - lastResetTime);
    console.log(`[Rate Limit] Waiting ${Math.ceil(waitTime / 1000)} seconds before next API call`);
    await new Promise(resolve => setTimeout(resolve, Math.min(waitTime + 1000, 10000)));
  }
};

// Get crypto price with aggressive caching and rate limiting
const getCryptoPrice = async (symbol) => {
  console.log(`[getCryptoPrice] Starting price fetch for symbol: ${symbol}`);
  
  try {
    const normalizedSymbol = symbol.toUpperCase();
    
    // 1. Check database cache first (most recent)
    try {
      const cachedPrice = await dbHelpers.getStockPrice(normalizedSymbol);
      if (cachedPrice) {
        const cacheAge = Date.now() - new Date(cachedPrice.last_updated).getTime();
        // Use cached price if less than 10 minutes old (increased from 5 minutes)
        if (cacheAge < 10 * 60 * 1000) {
          console.log(`[getCryptoPrice] Using database cache for ${symbol}: $${cachedPrice.price} (${Math.floor(cacheAge / 1000)}s old)`);
          return cachedPrice.price;
        }
      }
    } catch (dbError) {
      console.log(`[getCryptoPrice] Database cache check failed: ${dbError.message}`);
    }
    
    // 2. Check in-memory cache
    const cacheKey = normalizedSymbol;
    const cached = priceCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
      console.log(`[getCryptoPrice] Using memory cache for ${symbol}: $${cached.price}`);
      return cached.price;
    }
    
    // 3. Wait for rate limit before making API call
    await waitForRateLimit();
    
    // Convert symbol to CoinGecko ID
    let coinId = CRYPTO_ID_MAP[normalizedSymbol];
    
    if (!coinId) {
      // For unknown symbols, try a few common variations
      const commonVariations = [
        symbol.toLowerCase(),
        symbol.toLowerCase() + '-2',
        symbol.toLowerCase() + 'coin'
      ];
      
      console.log(`[getCryptoPrice] Symbol ${symbol} not in map, trying common variations...`);
      
      // Try each variation without using search API (to save rate limits)
      for (const variation of commonVariations) {
        try {
          await waitForRateLimit();
          apiCallCount++;
          
          const testResponse = await axios.get(`${COINGECKO_API_BASE}/simple/price`, {
            params: {
              ids: variation,
              vs_currencies: 'usd'
            },
            timeout: 10000
          });
          
          if (testResponse.data[variation]?.usd) {
            coinId = variation;
            console.log(`[getCryptoPrice] Found working variation: ${variation}`);
            break;
          }
        } catch (e) {
          // Continue to next variation
        }
      }
      
      if (!coinId) {
        throw new Error(`Cryptocurrency ${symbol} not found. Try common symbols like BTC, ETH, etc.`);
      }
    }
    
    // 4. Make the API call
    console.log(`[getCryptoPrice] Making API call for ${symbol} (${coinId})...`);
    await waitForRateLimit();
    apiCallCount++;
    
    const priceResponse = await axios.get(`${COINGECKO_API_BASE}/simple/price`, {
      params: {
        ids: coinId,
        vs_currencies: 'usd'
      },
      timeout: 15000
    });
    
    const coinData = priceResponse.data[coinId];
    if (!coinData?.usd && coinData?.usd !== 0) {
      throw new Error(`No price data returned for ${symbol}`);
    }
    
    const price = coinData.usd;
    console.log(`[getCryptoPrice] API call successful: ${symbol} = $${price}`);
    
    // 5. Cache the result
    priceCache.set(cacheKey, {
      price: price,
      timestamp: Date.now()
    });
    
    // 6. Update database cache
    try {
      await dbHelpers.updateStockPrice(normalizedSymbol, price);
    } catch (dbError) {
      console.log(`[getCryptoPrice] Failed to update database cache: ${dbError.message}`);
    }
    
    return price;
    
  } catch (error) {
    console.error(`[getCryptoPrice] Error for ${symbol}:`, error.message);
    
    // If rate limited, try to return cached data even if older
    if (error.response?.status === 429) {
      console.log(`[getCryptoPrice] Rate limited! Trying older cached data...`);
      
      // Try database cache with longer expiry
      try {
        const cachedPrice = await dbHelpers.getStockPrice(symbol.toUpperCase());
        if (cachedPrice) {
          const cacheAge = Date.now() - new Date(cachedPrice.last_updated).getTime();
          if (cacheAge < 60 * 60 * 1000) { // Accept 1-hour old data when rate limited
            console.log(`[getCryptoPrice] Using older database cache: $${cachedPrice.price} (${Math.floor(cacheAge / 60000)} min old)`);
            return cachedPrice.price;
          }
        }
      } catch (e) {
        // Continue to mock data
      }
      
      // Try memory cache even if expired
      const cached = priceCache.get(symbol.toUpperCase());
      if (cached) {
        console.log(`[getCryptoPrice] Using expired memory cache: $${cached.price}`);
        return cached.price;
      }
    }
    
    // Return mock data for development or as last resort
//     console.log(`[getCryptoPrice] Returning mock data for ${symbol}`);
//     const mockPrices = {
//       'BTC': 65000 + Math.random() * 10000,
//       'ETH': 3500 + Math.random() * 1000,
//       'BNB': 600 + Math.random() * 100,
//       'ADA': 0.4 + Math.random() * 0.2,
//       'DOGE': 0.08 + Math.random() * 0.05,
//       'SOL': 160 + Math.random() * 40,
//       'XRP': 0.5 + Math.random() * 0.2
//     };
    
//     const mockPrice = mockPrices[symbol.toUpperCase()] || (Math.random() * 100);
    
//     // Cache mock data too
//     priceCache.set(symbol.toUpperCase(), {
//       price: mockPrice,
//       timestamp: Date.now()
//     });
    
//     return mockPrice;
  }
};

// Batch fetch multiple prices (more efficient)
const getBatchPrices = async (symbols) => {
  if (!symbols.length) return {};
  
  try {
    // Convert all symbols to coin IDs
    const coinIds = symbols
      .map(symbol => CRYPTO_ID_MAP[symbol.toUpperCase()])
      .filter(id => id); // Remove undefined values
    
    if (!coinIds.length) {
      console.log('[getBatchPrices] No valid coin IDs found');
      return {};
    }
    
    await waitForRateLimit();
    apiCallCount++;
    
    console.log(`[getBatchPrices] Fetching batch prices for: ${coinIds.join(', ')}`);
    
    const response = await axios.get(`${COINGECKO_API_BASE}/simple/price`, {
      params: {
        ids: coinIds.join(','),
        vs_currencies: 'usd'
      },
      timeout: 15000
    });
    
    // Convert back to symbol-based object
    const prices = {};
    Object.entries(CRYPTO_ID_MAP).forEach(([symbol, coinId]) => {
      if (response.data[coinId]?.usd) {
        prices[symbol] = response.data[coinId].usd;
        
        // Cache the result
        priceCache.set(symbol, {
          price: response.data[coinId].usd,
          timestamp: Date.now()
        });
      }
    });
    
    console.log(`[getBatchPrices] Successfully fetched ${Object.keys(prices).length} prices`);
    return prices;
    
  } catch (error) {
    console.error('[getBatchPrices] Error:', error.message);
    return {};
  }
};

// Check all active alerts with better rate limiting
const checkPriceAlerts = async () => {
  try {
    console.log('Checking price alerts...');
    
    const alerts = await dbHelpers.getAllActiveAlerts();
    
    if (alerts.length === 0) {
      console.log('No active alerts to check');
      return;
    }

    // Get unique symbols
    const uniqueSymbols = [...new Set(alerts.map(alert => alert.symbol))];
    console.log(`Checking prices for ${uniqueSymbols.length} unique symbols: ${uniqueSymbols.join(', ')}`);
    
    // Try batch fetch first
    let batchPrices = await getBatchPrices(uniqueSymbols);
    
    // Group alerts by symbol
    const symbolGroups = {};
    alerts.forEach(alert => {
      if (!symbolGroups[alert.symbol]) {
        symbolGroups[alert.symbol] = [];
      }
      symbolGroups[alert.symbol].push(alert);
    });

    // Process each symbol
    for (const [symbol, symbolAlerts] of Object.entries(symbolGroups)) {
      try {
        // Use batch price if available, otherwise fetch individually
        let currentPrice = batchPrices[symbol];
        
        if (!currentPrice) {
          console.log(`Fetching individual price for ${symbol}...`);
          currentPrice = await getCryptoPrice(symbol);
          // Add extra delay for individual calls
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
        console.log(`${symbol}: $${currentPrice}`);

        // Update price in database
        try {
          await dbHelpers.updateStockPrice(symbol, currentPrice);
        } catch (dbError) {
          console.log(`Failed to update DB price for ${symbol}: ${dbError.message}`);
        }

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
            
            try {
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
            } catch (alertError) {
              console.error(`Failed to process alert for ${alert.email}: ${alertError.message}`);
            }
          }
        }
        
      } catch (error) {
        console.error(`Error checking ${symbol}:`, error.message);
      }
    }
    
    console.log(`Price alert check completed. API calls made: ${apiCallCount}/${MAX_CALLS_PER_MINUTE}`);
    
  } catch (error) {
    console.error('Error in price alert check:', error);
  }
};

// Start the price checking service with longer intervals to respect rate limits
const startPriceChecker = () => {
  // Run every 15 minutes to stay well within rate limits
  cron.schedule('*/15 * * * *', checkPriceAlerts);
  
  console.log('Crypto price checker scheduled (every 15 minutes to respect rate limits)');
};

module.exports = { startPriceChecker, getCryptoPrice, checkPriceAlerts, getBatchPrices };