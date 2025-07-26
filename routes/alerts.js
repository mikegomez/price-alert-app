// routes/alerts.js
const express = require('express');
const router = express.Router();
// Correctly import verifyToken using destructuring from the auth module
const { verifyToken } = require('./auth');
const { dbHelpers } = require('../database/db');
const { getCryptoPrice } = require('../services/priceChecker');

// Get all alerts for a user
router.get('/', verifyToken, async (req, res) => {
    try {
        // userId is populated by the verifyToken middleware
        const userId = req.user.userId;
        const alerts = await dbHelpers.getUserAlerts(userId);

        // Add current prices to alerts
        const alertsWithPrices = await Promise.all(
            alerts.map(async (alert) => {
                try {
                    // Attempt to get cached price first
                    const cachedPrice = await dbHelpers.getStockPrice(alert.symbol);
                    return {
                        ...alert,
                        currentPrice: cachedPrice ? cachedPrice.price : null,
                        lastUpdated: cachedPrice ? cachedPrice.last_updated : null
                    };
                } catch (error) {
                    console.warn(`Could not fetch cached price for ${alert.symbol}:`, error.message);
                    // If fetching cached price fails, return alert without currentPrice/lastUpdated
                    return {
                        ...alert,
                        currentPrice: null,
                        lastUpdated: null
                    };
                }
            })
        );

        res.json({ alerts: alertsWithPrices });
    } catch (error) {
        console.error('Error fetching alerts:', error);
        res.status(500).json({ error: 'Failed to fetch alerts' });
    }
});

// Create a new price alert
router.post('/', verifyToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { symbol, targetPrice, alertType } = req.body;

        // Validate input
        if (!symbol || !targetPrice || !alertType) {
            return res.status(400).json({
                error: 'Symbol, targetPrice, and alertType are required'
            });
        }

        if (!['above', 'below'].includes(alertType)) {
            return res.status(400).json({
                error: 'alertType must be "above" or "below"'
            });
        }

        if (isNaN(targetPrice) || targetPrice <= 0) {
            return res.status(400).json({
                error: 'targetPrice must be a number greater than 0'
            });
        }

        // Validate that the cryptocurrency exists and get its current price
        let currentPrice;
        try {
            currentPrice = await getCryptoPrice(symbol);

            // Check if alert makes sense based on current price
            if (alertType === 'above' && currentPrice >= targetPrice) {
                return res.status(400).json({
                    error: `Current price ($${currentPrice.toFixed(2)}) is already above or equal to target price ($${targetPrice}). Alert would trigger immediately.`
                });
            }

            if (alertType === 'below' && currentPrice <= targetPrice) {
                return res.status(400).json({
                    error: `Current price ($${currentPrice.toFixed(2)}) is already below or equal to target price ($${targetPrice}). Alert would trigger immediately.`
                });
            }

        } catch (error) {
            console.error(`Error validating cryptocurrency ${symbol}:`, error.message);
            return res.status(400).json({
                error: `Cryptocurrency ${symbol} not found or price could not be fetched.`
            });
        }

        // Create the alert in the database
        const alertId = await dbHelpers.createAlert(
            userId,
            symbol.toUpperCase(),
            targetPrice,
            alertType
        );

        res.status(201).json({
            message: 'Alert created successfully',
            alertId: alertId,
            alert: {
                id: alertId,
                symbol: symbol.toUpperCase(),
                targetPrice: targetPrice,
                alertType: alertType,
                isActive: true, // New alerts are typically active
                createdAt: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('Error creating alert:', error);
        res.status(500).json({ error: 'Failed to create alert' });
    }
});

// Update an alert
router.put('/:id', verifyToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const alertId = req.params.id;
        const { targetPrice, alertType, isActive } = req.body; // Added isActive for potential update

        // First check if alert exists and belongs to user
        const existingAlert = await dbHelpers.getAlertByIdAndUser(alertId, userId);

        if (!existingAlert) {
            return res.status(404).json({ error: 'Alert not found or does not belong to user' });
        }

        // Validate input for updates
        if (targetPrice !== undefined) {
            if (isNaN(targetPrice) || targetPrice <= 0) {
                return res.status(400).json({
                    error: 'targetPrice must be a number greater than 0 if provided'
                });
            }
        }

        if (alertType !== undefined) {
            if (!['above', 'below'].includes(alertType)) {
                return res.status(400).json({
                    error: 'alertType must be "above" or "below" if provided'
                });
            }
        }

        if (isActive !== undefined && typeof isActive !== 'boolean') {
            return res.status(400).json({
                error: 'isActive must be a boolean if provided'
            });
        }

        // Prepare update data
        const updateData = {};
        if (targetPrice !== undefined) updateData.target_price = targetPrice;
        if (alertType !== undefined) updateData.alert_type = alertType;
        if (isActive !== undefined) updateData.is_active = isActive ? 1 : 0; // Assuming boolean to integer conversion for DB

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ error: 'No valid fields provided for update' });
        }

        // Update the alert in the database
        await dbHelpers.updateAlert(alertId, userId, updateData);

        res.json({ message: 'Alert updated successfully' });

    } catch (error) {
        console.error('Error updating alert:', error);
        res.status(500).json({ error: 'Failed to update alert' });
    }
});

// Delete an alert
router.delete('/:id', verifyToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const alertId = req.params.id;

        // First check if alert exists and belongs to user
        const existingAlert = await dbHelpers.getAlertByIdAndUser(alertId, userId);

        if (!existingAlert) {
            return res.status(404).json({ error: 'Alert not found or does not belong to user' });
        }

        // Delete the alert from the database
        await dbHelpers.deleteAlert(alertId, userId);

        res.json({ message: 'Alert deleted successfully' });

    } catch (error) {
        console.error('Error deleting alert:', error);
        res.status(500).json({ error: 'Failed to delete alert' });
    }
});

// Get alert history (triggered alerts)
router.get('/history', verifyToken, async (req, res) => {
    try {
        const userId = req.user.userId;

        const history = await dbHelpers.getTriggeredAlertsHistory(userId);

        res.json({ history });

    } catch (error) {
        console.error('Error fetching alert history:', error);
        res.status(500).json({ error: 'Failed to fetch alert history' });
    }
});

// Test an alert (check if it would trigger now)
router.post('/test', verifyToken, async (req, res) => {
    try {
        const { symbol, targetPrice, alertType } = req.body;

        if (!symbol || !targetPrice || !alertType) {
            return res.status(400).json({
                error: 'Symbol, targetPrice, and alertType are required'
            });
        }

        if (isNaN(targetPrice) || targetPrice <= 0) {
            return res.status(400).json({
                error: 'targetPrice must be a number greater than 0'
            });
        }

        if (!['above', 'below'].includes(alertType)) {
            return res.status(400).json({
                error: 'alertType must be "above" or "below"'
            });
        }

        // Get current price
        let currentPrice;
        try {
            currentPrice = await getCryptoPrice(symbol);
        } catch (error) {
            console.error(`Error fetching price for ${symbol} during test:`, error.message);
            return res.status(400).json({
                error: `Could not fetch current price for ${symbol}. Please check the symbol.`
            });
        }

        // Check if alert would trigger
        let wouldTrigger = false;
        if (alertType === 'above' && currentPrice >= targetPrice) {
            wouldTrigger = true;
        } else if (alertType === 'below' && currentPrice <= targetPrice) {
            wouldTrigger = true;
        }

        res.json({
            symbol: symbol.toUpperCase(),
            currentPrice: currentPrice,
            targetPrice: targetPrice,
            alertType: alertType,
            wouldTrigger: wouldTrigger,
            message: wouldTrigger
                ? `Alert would trigger! ${symbol} is currently $${currentPrice.toFixed(2)}, which is ${alertType} $${targetPrice}.`
                : `Alert would not trigger. ${symbol} is currently $${currentPrice.toFixed(2)}, which is ${alertType === 'above' ? 'below' : 'above'} $${targetPrice}.`
        });

    } catch (error) {
        console.error('Error testing alert:', error);
        res.status(500).json({ error: 'Failed to test alert' });
    }
});

module.exports = router;
