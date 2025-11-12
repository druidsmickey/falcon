const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');

// Import the models
const AppData = require('./Modal/AppData');
const BetTransaction = require('./Modal/BetTransaction');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/gamesdb';

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ Connected to MongoDB successfully'))
.catch(err => console.error('❌ MongoDB connection error:', err));

// ==================== API Routes ====================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// Get all app data (latest entry for specific market type)
app.get('/api/appdata', async (req, res) => {
  try {
    const marketType = parseInt(req.query.marketType) || 0;
    const marketName = marketType === 0 ? 'Local' : 'International';
    
    console.log(`📥 GET request for ${marketName} data (marketType: ${marketType})`);
    
    const data = await AppData.findOne({ marketType: marketType }).sort({ updatedAt: -1 });
    
    if (!data) {
      console.log(`📭 No ${marketName} data found in database`);
      return res.json({
        marketType: marketType,
        numEvents: null,
        events: [],
        selectedEventId: null,
        eventData: {}
      });
    }
    
    console.log(`✅ Found ${marketName} data:`, { numEvents: data.numEvents, eventsCount: data.events?.length });
    res.json(data);
  } catch (error) {
    console.error('Error fetching app data:', error);
    res.status(500).json({ error: 'Failed to fetch app data' });
  }
});

// Get app data by ID
app.get('/api/appdata/:id', async (req, res) => {
  try {
    const data = await AppData.findById(req.params.id);
    if (!data) {
      return res.status(404).json({ error: 'App data not found' });
    }
    res.json(data);
  } catch (error) {
    console.error('Error fetching app data by ID:', error);
    res.status(500).json({ error: 'Failed to fetch app data' });
  }
});

// Create or update app data
app.post('/api/appdata', async (req, res) => {
  try {
    console.log('📥 Received POST request body:', JSON.stringify(req.body, null, 2));
    
    const { marketType, numEvents, events, selectedEventId, eventData } = req.body;

    // Convert eventData object to array format for MongoDB
    const eventDataArray = eventData && typeof eventData === 'object' 
      ? Object.keys(eventData).map(key => {
          const event = eventData[key];
          console.log(`📋 Processing event ${key}:`, JSON.stringify(event, null, 2));
          return {
            eventId: parseInt(key),
            ...event
          };
        })
      : [];

    console.log('📊 Converted eventDataArray:', JSON.stringify(eventDataArray, null, 2));

    // Create new app data entry
    const newAppData = new AppData({
      marketType,
      numEvents,
      events,
      selectedEventId,
      eventData: eventDataArray,
      updatedAt: new Date()
    });

    const savedData = await newAppData.save();
    console.log('✅ App data saved successfully:', savedData._id);
    res.status(201).json({ 
      message: 'App data saved successfully',
      id: savedData._id,
      data: savedData
    });
  } catch (error) {
    console.error('❌ Error saving app data:', error);
    console.error('❌ Error details:', error.message);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to save app data', details: error.message });
  }
});

// Update existing app data
app.put('/api/appdata/:id', async (req, res) => {
  try {
    const { marketType, numEvents, events, selectedEventId, eventData } = req.body;

    // Convert eventData object to array format for MongoDB
    const eventDataArray = eventData && typeof eventData === 'object' 
      ? Object.keys(eventData).map(key => ({
          eventId: parseInt(key),
          ...eventData[key]
        }))
      : [];

    const updatedData = await AppData.findByIdAndUpdate(
      req.params.id,
      {
        marketType,
        numEvents,
        events,
        selectedEventId,
        eventData: eventDataArray,
        updatedAt: new Date()
      },
      { new: true, runValidators: true }
    );

    if (!updatedData) {
      return res.status(404).json({ error: 'App data not found' });
    }

    console.log('✅ App data updated successfully:', updatedData._id);
    res.json({ 
      message: 'App data updated successfully',
      data: updatedData
    });
  } catch (error) {
    console.error('Error updating app data:', error);
    res.status(500).json({ error: 'Failed to update app data', details: error.message });
  }
});

// Delete app data by ID
app.delete('/api/appdata/:id', async (req, res) => {
  try {
    const deletedData = await AppData.findByIdAndDelete(req.params.id);
    if (!deletedData) {
      return res.status(404).json({ error: 'App data not found' });
    }
    console.log('✅ App data deleted successfully:', req.params.id);
    res.json({ message: 'App data deleted successfully' });
  } catch (error) {
    console.error('Error deleting app data:', error);
    res.status(500).json({ error: 'Failed to delete app data' });
  }
});

// Get all historical app data entries
app.get('/api/appdata/history/all', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const data = await AppData.find()
      .sort({ updatedAt: -1 })
      .limit(limit);
    res.json(data);
  } catch (error) {
    console.error('Error fetching app data history:', error);
    res.status(500).json({ error: 'Failed to fetch app data history' });
  }
});

// Get specific event data by race number
app.get('/api/event/:eventId', async (req, res) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const appData = await AppData.findOne().sort({ updatedAt: -1 });
    
    if (!appData) {
      return res.status(404).json({ error: 'No app data found' });
    }

    const eventData = appData.eventData.find(e => e.eventId === eventId);
    if (!eventData) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json(eventData);
  } catch (error) {
    console.error('Error fetching event data:', error);
    res.status(500).json({ error: 'Failed to fetch event data' });
  }
});

// Clear app data for specific market type
app.delete('/api/appdata/clear/:marketType', async (req, res) => {
  try {
    const marketType = parseInt(req.params.marketType);
    const marketName = marketType === 0 ? 'Local' : 'International';
    
    await AppData.deleteMany({ marketType: marketType });
    console.log(`✅ ${marketName} app data cleared`);
    res.json({ message: `${marketName} app data cleared successfully` });
  } catch (error) {
    console.error('Error clearing app data:', error);
    res.status(500).json({ error: 'Failed to clear app data' });
  }
});

// Clear all app data (both Local and International)
app.delete('/api/appdata/clear/all', async (req, res) => {
  try {
    await AppData.deleteMany({});
    console.log('✅ All app data cleared (Local and International)');
    res.json({ message: 'All app data cleared successfully' });
  } catch (error) {
    console.error('Error clearing app data:', error);
    res.status(500).json({ error: 'Failed to clear app data' });
  }
});

// ==================== Bet Transaction Routes ====================

// Get recent client names with their last bet details
app.get('/api/recent-clients', async (req, res) => {
  try {
    const marketType = parseInt(req.query.marketType) || 0;
    const limit = parseInt(req.query.limit) || 7;
    const marketName = marketType === 0 ? 'Local' : 'International';
    
    console.log(`📥 GET request for ${limit} recent ${marketName} clients (marketType: ${marketType})`);
    
    // Get all transactions for this market, sorted by most recent
    const recentTransactions = await BetTransaction.find({ marketType: marketType })
      .sort({ createdAt: -1 })
      .limit(100); // Get more to find unique clients
    
    // Extract unique client names and their last bet details
    const clientsMap = new Map();
    for (const transaction of recentTransactions) {
      const clientName = transaction.clientName;
      if (clientName && !clientsMap.has(clientName)) {
        clientsMap.set(clientName, {
          clientName: clientName,
          lastBetType: transaction.isF500 ? 'f500' : 'odds',
          lastOddsValue: transaction.isF500 ? transaction.f500 : transaction.odds100,
          lastTax: transaction.tax || 0
        });
        
        if (clientsMap.size >= limit) {
          break;
        }
      }
    }
    
    const recentClients = Array.from(clientsMap.values());
    console.log(`✅ Found ${recentClients.length} unique clients`);
    res.json(recentClients);
  } catch (error) {
    console.error('Error fetching recent clients:', error);
    res.status(500).json({ error: 'Failed to fetch recent clients' });
  }
});

// Save a new bet transaction
app.post('/api/bet-transaction', async (req, res) => {
  try {
    console.log('📥 Received bet transaction:', JSON.stringify(req.body, null, 2));
    
    const betTransaction = new BetTransaction(req.body);
    const savedTransaction = await betTransaction.save();
    
    console.log('✅ Bet transaction saved:', savedTransaction._id);
    res.status(201).json({
      message: 'Bet transaction saved successfully',
      id: savedTransaction._id,
      data: savedTransaction
    });
  } catch (error) {
    console.error('❌ Error saving bet transaction:', error);
    res.status(500).json({ error: 'Failed to save bet transaction', details: error.message });
  }
});

// Update a bet transaction (e.g., for cancellation)
app.put('/api/bet-transaction/:id', async (req, res) => {
  try {
    console.log('📝 Updating bet transaction:', req.params.id);
    
    const updatedTransaction = await BetTransaction.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!updatedTransaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    
    console.log('✅ Bet transaction updated:', updatedTransaction._id);
    res.json({
      message: 'Bet transaction updated successfully',
      data: updatedTransaction
    });
  } catch (error) {
    console.error('❌ Error updating bet transaction:', error);
    res.status(500).json({ error: 'Failed to update bet transaction', details: error.message });
  }
});

// Get all bet transactions for a specific market type
app.get('/api/bet-transactions', async (req, res) => {
  try {
    const marketType = parseInt(req.query.marketType) || 0;
    const raceNum = req.query.raceNum ? parseInt(req.query.raceNum) : null;
    const marketName = marketType === 0 ? 'Local' : 'International';
    
    let query = { marketType: marketType };
    if (raceNum !== null) {
      query.raceNum = raceNum;
    }
    
    const transactions = await BetTransaction.find(query).sort({ createdAt: -1 });
    
    console.log(`📊 Found ${transactions.length} ${marketName} bet transactions`);
    res.json(transactions);
  } catch (error) {
    console.error('Error fetching bet transactions:', error);
    res.status(500).json({ error: 'Failed to fetch bet transactions' });
  }
});

// Get a specific bet transaction by ID
app.get('/api/bet-transaction/:id', async (req, res) => {
  try {
    const transaction = await BetTransaction.findById(req.params.id);
    if (!transaction) {
      return res.status(404).json({ error: 'Bet transaction not found' });
    }
    res.json(transaction);
  } catch (error) {
    console.error('Error fetching bet transaction:', error);
    res.status(500).json({ error: 'Failed to fetch bet transaction' });
  }
});

// Update a bet transaction
app.put('/api/bet-transaction/:id', async (req, res) => {
  try {
    const updatedTransaction = await BetTransaction.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: new Date() },
      { new: true, runValidators: true }
    );
    
    if (!updatedTransaction) {
      return res.status(404).json({ error: 'Bet transaction not found' });
    }
    
    console.log('✅ Bet transaction updated:', updatedTransaction._id);
    res.json({
      message: 'Bet transaction updated successfully',
      data: updatedTransaction
    });
  } catch (error) {
    console.error('Error updating bet transaction:', error);
    res.status(500).json({ error: 'Failed to update bet transaction', details: error.message });
  }
});

// Delete a bet transaction
app.delete('/api/bet-transaction/:id', async (req, res) => {
  try {
    const deletedTransaction = await BetTransaction.findByIdAndDelete(req.params.id);
    if (!deletedTransaction) {
      return res.status(404).json({ error: 'Bet transaction not found' });
    }
    console.log('✅ Bet transaction deleted:', req.params.id);
    res.json({ message: 'Bet transaction deleted successfully' });
  } catch (error) {
    console.error('Error deleting bet transaction:', error);
    res.status(500).json({ error: 'Failed to delete bet transaction' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  console.log(`📊 API endpoints:`);
  console.log(`   GET    /api/health - Health check`);
  console.log(`   GET    /api/appdata?marketType=0|1 - Get latest app data for market type`);
  console.log(`   GET    /api/appdata/:id - Get app data by ID`);
  console.log(`   POST   /api/appdata - Save new app data`);
  console.log(`   PUT    /api/appdata/:id - Update app data`);
  console.log(`   DELETE /api/appdata/:id - Delete app data`);
  console.log(`   GET    /api/appdata/history/all - Get all historical data`);
  console.log(`   GET    /api/event/:eventId - Get specific event data`);
  console.log(`   DELETE /api/appdata/clear/:marketType - Clear data for specific market (0=Local, 1=International)`);
  console.log(`   DELETE /api/appdata/clear/all - Clear all data (both markets)`);
  console.log(`   GET    /api/recent-clients?marketType=0|1&limit=N - Get recent client names with last bet info`);
  console.log(`   POST   /api/bet-transaction - Save new bet transaction`);
  console.log(`   GET    /api/bet-transactions?marketType=0|1&raceNum=X - Get bet transactions`);
  console.log(`   GET    /api/bet-transaction/:id - Get bet transaction by ID`);
  console.log(`   PUT    /api/bet-transaction/:id - Update bet transaction`);
  console.log(`   DELETE /api/bet-transaction/:id - Delete bet transaction`);
});

module.exports = app;
