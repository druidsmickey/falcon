const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3030;

// Data file paths - separate files for Local and International
const LOCAL_DATA_FILE = path.join(__dirname, 'data', 'appdata-local.json');
const INTERNATIONAL_DATA_FILE = path.join(__dirname, 'data', 'appdata-international.json');

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Ensure data directory exists
async function ensureDataDirectory() {
  const dataDir = path.join(__dirname, 'data');
  try {
    await fs.mkdir(dataDir, { recursive: true });
    console.log('✅ Data directory ready');
  } catch (error) {
    console.error('Error creating data directory:', error);
  }
}

// Get data file path based on market type
function getDataFile(marketType) {
  return marketType === 0 ? LOCAL_DATA_FILE : INTERNATIONAL_DATA_FILE;
}

// Read data from file for specific market type
async function readData(marketType = 0) {
  const dataFile = getDataFile(marketType);
  try {
    const data = await fs.readFile(dataFile, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    // If file doesn't exist, return default data
    return {
      marketType: marketType,
      numEvents: null,
      events: [],
      selectedEventId: null,
      eventData: {},
      history: []
    };
  }
}

// Write data to file for specific market type
async function writeData(data, marketType = 0) {
  const dataFile = getDataFile(marketType);
  try {
    await fs.writeFile(dataFile, JSON.stringify(data, null, 2), 'utf8');
    const marketName = marketType === 0 ? 'Local' : 'International';
    console.log(`✅ ${marketName} data saved to file`);
  } catch (error) {
    console.error('Error writing data:', error);
    throw error;
  }
}

// ==================== API Routes ====================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Server is running (File-based storage)',
    timestamp: new Date().toISOString()
  });
});

// Get all app data (latest entry) - supports marketType query parameter
app.get('/api/appdata', async (req, res) => {
  try {
    const marketType = parseInt(req.query.marketType) || 0;
    const data = await readData(marketType);
    res.json({
      marketType: data.marketType,
      numEvents: data.numEvents,
      events: data.events,
      selectedEventId: data.selectedEventId,
      eventData: data.eventData
    });
  } catch (error) {
    console.error('Error fetching app data:', error);
    res.status(500).json({ error: 'Failed to fetch app data' });
  }
});

// Create or update app data
app.post('/api/appdata', async (req, res) => {
  try {
    console.log('📥 POST /api/appdata received');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    
    const { marketType, numEvents, events, selectedEventId, eventData } = req.body;
    const targetMarketType = marketType !== undefined ? marketType : 0;

    // Read current data for this market type
    const currentData = await readData(targetMarketType);

    // Save to history
    if (!currentData.history) {
      currentData.history = [];
    }
    
    currentData.history.push({
      marketType: currentData.marketType,
      numEvents: currentData.numEvents,
      events: currentData.events,
      selectedEventId: currentData.selectedEventId,
      eventData: currentData.eventData,
      timestamp: new Date().toISOString()
    });

    // Keep only last 10 history entries
    if (currentData.history.length > 10) {
      currentData.history = currentData.history.slice(-10);
    }

    // Update current data
    const updatedData = {
      marketType: targetMarketType,
      numEvents: numEvents !== undefined ? numEvents : currentData.numEvents,
      events: events || currentData.events,
      selectedEventId: selectedEventId !== undefined ? selectedEventId : currentData.selectedEventId,
      eventData: eventData || currentData.eventData,
      history: currentData.history,
      lastUpdated: new Date().toISOString()
    };

    await writeData(updatedData, targetMarketType);
    
    const marketName = targetMarketType === 0 ? 'Local' : 'International';
    console.log(`✅ ${marketName} app data saved successfully`);
    res.status(201).json({ 
      message: `${marketName} app data saved successfully`,
      data: {
        marketType: updatedData.marketType,
        numEvents: updatedData.numEvents,
        events: updatedData.events,
        selectedEventId: updatedData.selectedEventId,
        eventData: updatedData.eventData
      }
    });
  } catch (error) {
    console.error('❌ Error saving app data:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to save app data', details: error.message, stack: error.stack });
  }
});

// Update existing app data (PUT)
app.put('/api/appdata', async (req, res) => {
  try {
    const { marketType, numEvents, events, selectedEventId, eventData } = req.body;
    const targetMarketType = marketType !== undefined ? marketType : 0;

    const updatedData = {
      marketType: targetMarketType,
      numEvents,
      events,
      selectedEventId,
      eventData,
      lastUpdated: new Date().toISOString()
    };

    await writeData(updatedData, targetMarketType);
    
    const marketName = targetMarketType === 0 ? 'Local' : 'International';
    console.log(`✅ ${marketName} app data updated successfully`);
    res.json({ 
      message: `${marketName} app data updated successfully`,
      data: updatedData
    });
  } catch (error) {
    console.error('Error updating app data:', error);
    res.status(500).json({ error: 'Failed to update app data', details: error.message });
  }
});

// Get historical app data entries
app.get('/api/appdata/history/all', async (req, res) => {
  try {
    const data = await readData();
    const limit = parseInt(req.query.limit) || 10;
    const history = data.history || [];
    res.json(history.slice(-limit));
  } catch (error) {
    console.error('Error fetching app data history:', error);
    res.status(500).json({ error: 'Failed to fetch app data history' });
  }
});

// Get specific event data by race number
app.get('/api/event/:eventId', async (req, res) => {
  try {
    const eventId = req.params.eventId;
    const data = await readData();
    
    if (!data.eventData || !data.eventData[eventId]) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json(data.eventData[eventId]);
  } catch (error) {
    console.error('Error fetching event data:', error);
    res.status(500).json({ error: 'Failed to fetch event data' });
  }
});

// Clear app data for specific market type
app.delete('/api/appdata/clear/:marketType', async (req, res) => {
  try {
    const marketType = parseInt(req.params.marketType);
    const defaultData = {
      marketType: marketType,
      numEvents: null,
      events: [],
      selectedEventId: null,
      eventData: {},
      history: []
    };
    
    await writeData(defaultData, marketType);
    const marketName = marketType === 0 ? 'Local' : 'International';
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
    const defaultDataLocal = {
      marketType: 0,
      numEvents: null,
      events: [],
      selectedEventId: null,
      eventData: {},
      history: []
    };
    
    const defaultDataInternational = {
      marketType: 1,
      numEvents: null,
      events: [],
      selectedEventId: null,
      eventData: {},
      history: []
    };
    
    await writeData(defaultDataLocal, 0);
    await writeData(defaultDataInternational, 1);
    console.log('✅ All app data (Local and International) cleared');
    res.json({ message: 'All app data cleared successfully' });
  } catch (error) {
    console.error('Error clearing app data:', error);
    res.status(500).json({ error: 'Failed to clear app data' });
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

// Initialize and start server
ensureDataDirectory().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
    console.log(`💾 Using separate file-based storage:`);
    console.log(`   Local: ${LOCAL_DATA_FILE}`);
    console.log(`   International: ${INTERNATIONAL_DATA_FILE}`);
    console.log(`📊 API endpoints:`);
    console.log(`   GET    /api/health - Health check`);
    console.log(`   GET    /api/appdata?marketType=0 - Get Local data`);
    console.log(`   GET    /api/appdata?marketType=1 - Get International data`);
    console.log(`   POST   /api/appdata - Save app data (include marketType in body)`);
    console.log(`   PUT    /api/appdata - Update app data (include marketType in body)`);
    console.log(`   GET    /api/appdata/history/all - Get all historical data`);
    console.log(`   GET    /api/event/:eventId - Get specific event data`);
    console.log(`   DELETE /api/appdata/clear/0 - Clear Local data`);
    console.log(`   DELETE /api/appdata/clear/1 - Clear International data`);
    console.log(`   DELETE /api/appdata/clear/all - Clear all data (both markets)`);
    console.log(``);
    console.log(`💡 To use MongoDB instead, install MongoDB and run: node server.js`);
  });
});

module.exports = app;
