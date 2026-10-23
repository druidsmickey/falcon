require('dotenv').config({ path: __dirname + '/.env' });
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const compression = require('compression');

const { router: authRouter, authenticateToken } = require('./routes/auth');
const whatsappRouter = require('./routes/whatsapp');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(compression()); // Gzip compress all responses
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// MongoDB Connection with optimized settings
mongoose.connect(process.env.MONGODB_URI, {
  maxPoolSize: 10,
  minPoolSize: 2,
  socketTimeoutMS: 45000,
  serverSelectionTimeoutMS: 5000,
  heartbeatFrequencyMS: 10000,
})
.then(() => {
  console.log('âœ… Successfully connected to MongoDB');
})
.catch((err) => {
  console.error('âŒ MongoDB connection error:', err);
  process.exit(1);
});

mongoose.connection.on('error', (err) => {
  console.error('Mongoose connection error:', err);
});

// Import models
const Init = require('./models/init');
const Params = require('./models/params');
const Bets = require('./models/bets');
const Report = require('./model/report');
const SyncAudit = require('./models/syncAudit');

async function logSyncEvent(req, event) {
  try {
    await SyncAudit.create({
      operation: event.operation,
      status: event.status,
      clientRequestId: event.clientRequestId,
      meetingName: event.meetingName,
      userId: req.user?.userId,
      username: req.user?.username,
      appScope: req.user?.appScope,
      message: event.message,
      payloadSummary: event.payloadSummary,
    });
  } catch (error) {
    console.error('Sync audit logging failed:', error.message);
  }
}

async function isDuplicateSyncRequest(operation, clientRequestId) {
  if (!clientRequestId) return false;

  const existing = await SyncAudit.findOne({
    operation,
    clientRequestId,
    status: { $in: ['synced', 'duplicate'] }
  })
    .select('_id')
    .lean();

  return Boolean(existing);
}

// â”€â”€ In-memory cache with TTL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const cache = new Map(); // key â†’ { data, expiry }
const CACHE_TTL = 30_000; // 30 seconds

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) { cache.delete(key); return null; }
  return entry.data;
}

function cacheSet(key, data, ttl = CACHE_TTL) {
  cache.set(key, { data, expiry: Date.now() + ttl });
}

function cacheInvalidate(...prefixes) {
  for (const [key] of cache) {
    if (prefixes.some(p => key.startsWith(p))) cache.delete(key);
  }
}

// Basic route
app.use('/auth', authRouter);
app.use('/api/whatsapp', authenticateToken, whatsappRouter);

app.get('/', (req, res) => {
  res.json({ 
    message: 'Server is running!',
    database: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    database: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected',
    timestamp: new Date().toISOString()
  });
});

// Protect all /api routes with authentication
app.use('/api', authenticateToken);

// Init API endpoints

// Get all meeting names
app.get('/api/meetings', async (req, res) => {
  try {
    const cached = cacheGet('meetings');
    if (cached) return res.json(cached);

    const meetings = await Init.aggregate([
      {
        $group: {
          _id: '$meetingName',
          latestDate: { $max: '$createdAt' }
        }
      },
      {
        $sort: { latestDate: -1 }
      },
      {
        $project: {
          _id: 0,
          meetingName: '$_id'
        }
      }
    ]);
    const result = meetings.map(m => m.meetingName);
    cacheSet('meetings', result);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get races for a specific meeting
app.get('/api/meetings/:meetingName/races', async (req, res) => {
  try {
    const key = `races:${req.params.meetingName}`;
    const cached = cacheGet(key);
    if (cached) return res.json(cached);

    const races = await Init.find({ meetingName: req.params.meetingName })
      .sort({ raceNum: 1 })
      .select('-__v')
      .lean();
    cacheSet(key, races);
    res.json(races);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save races for a meeting (create or update)
app.post('/api/meetings/races', async (req, res) => {
  try {
    const { meetingName, races, selected, clientRequestId, syncBaseUpdatedAt } = req.body;
    
    if (!meetingName) {
      return res.status(400).json({ error: 'Meeting name is required' });
    }
    
    if (!races || !Array.isArray(races) || races.length === 0) {
      return res.status(400).json({ error: 'Races array is required' });
    }

    if (await isDuplicateSyncRequest('save-meeting-races', clientRequestId)) {
      await logSyncEvent(req, {
        operation: 'save-meeting-races',
        status: 'duplicate',
        clientRequestId,
        meetingName,
        message: 'Duplicate meeting races sync ignored',
        payloadSummary: { raceCount: races.length }
      });
      return res.json({ success: true, duplicate: true });
    }

    if (syncBaseUpdatedAt) {
      const latest = await Init.findOne({ meetingName }).sort({ updatedAt: -1 }).select('updatedAt').lean();
      if (latest?.updatedAt && new Date(latest.updatedAt) > new Date(syncBaseUpdatedAt)) {
        await logSyncEvent(req, {
          operation: 'save-meeting-races',
          status: 'conflict',
          clientRequestId,
          meetingName,
          message: 'Meeting races changed on server after offline edit',
          payloadSummary: { raceCount: races.length }
        });
        return res.status(409).json({ error: 'Conflict detected. Meeting was updated by another source.' });
      }
    }
    
    // If selected is true, set all other meetings to false
    if (selected) {
      await Init.updateMany(
        { meetingName: { $ne: meetingName } },
        { $set: { selected: false } }
      );
    }
    
    // Delete existing races for this meeting
    await Init.deleteMany({ meetingName });
    
    // Insert new races
    const savedRaces = await Init.insertMany(
      races.map(race => ({
        meetingName,
        raceNum: race.raceNum,
        raceName: race.raceName,
        numHorse: race.numHorse,
        selected: selected || false
      }))
    );
    
    // Invalidate all init/race caches
    cacheInvalidate('meetings', 'races:', 'selected-races');

    if (clientRequestId) {
      await logSyncEvent(req, {
        operation: 'save-meeting-races',
        status: 'synced',
        clientRequestId,
        meetingName,
        message: 'Meeting races synced',
        payloadSummary: { raceCount: races.length }
      });
    }

    res.json({ success: true, races: savedRaces });
  } catch (error) {
    if (req.body?.clientRequestId) {
      await logSyncEvent(req, {
        operation: 'save-meeting-races',
        status: 'failed',
        clientRequestId: req.body.clientRequestId,
        meetingName: req.body.meetingName,
        message: error.message,
        payloadSummary: { raceCount: req.body?.races?.length || 0 }
      });
    }
    console.error('Error in POST /api/meetings/races:', error);
    res.status(500).json({ error: error.message });
  }
});

// Params API endpoints

// Get all races where selected is true
app.get('/api/params/selected-races', async (req, res) => {
  try {
    const cached = cacheGet('selected-races');
    if (cached) return res.json(cached);

    const selectedRaces = await Init.find({ selected: true })
      .sort({ raceNum: 1 })
      .select('raceNum numHorse raceName meetingName selected')
      .lean();
    cacheSet('selected-races', selectedRaces);
    res.json(selectedRaces);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get params for selected races
app.get('/api/params', async (req, res) => {
  try {
    const { meetingName } = req.query;
    const key = `params:${meetingName || 'all'}`;
    const cached = cacheGet(key);
    if (cached) return res.json(cached);

    const query = meetingName ? { meetingName } : {};
    const params = await Params.find(query)
      .sort({ raceNum: 1, horseNum: 1 })
      .select('-__v')
      .lean();
    cacheSet(key, params);
    res.json(params);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save params (bulk upsert)
app.post('/api/params', async (req, res) => {
  try {
    const { params, clientRequestId, syncBaseUpdatedAt } = req.body;
    
    if (!params || !Array.isArray(params)) {
      return res.status(400).json({ error: 'Params array is required' });
    }
    
    // Get meetingName from first param
    const meetingName = params.length > 0 ? params[0].meetingName : null;

    if (await isDuplicateSyncRequest('save-params', clientRequestId)) {
      await logSyncEvent(req, {
        operation: 'save-params',
        status: 'duplicate',
        clientRequestId,
        meetingName,
        message: 'Duplicate params sync ignored',
        payloadSummary: { rowCount: params.length }
      });
      return res.json({ success: true, duplicate: true });
    }

    if (meetingName && syncBaseUpdatedAt) {
      const latest = await Params.findOne({ meetingName }).sort({ updatedAt: -1 }).select('updatedAt').lean();
      if (latest?.updatedAt && new Date(latest.updatedAt) > new Date(syncBaseUpdatedAt)) {
        await logSyncEvent(req, {
          operation: 'save-params',
          status: 'conflict',
          clientRequestId,
          meetingName,
          message: 'Params changed on server after offline edit',
          payloadSummary: { rowCount: params.length }
        });
        return res.status(409).json({ error: 'Conflict detected. Parameters were updated by another source.' });
      }
    }
    
    if (meetingName) {
      // Delete only params for this meeting
      await Params.deleteMany({ meetingName });
    }
    
    // Insert new params
    const savedParams = await Params.insertMany(params);
    
    cacheInvalidate('params:');

    if (clientRequestId) {
      await logSyncEvent(req, {
        operation: 'save-params',
        status: 'synced',
        clientRequestId,
        meetingName,
        message: 'Parameters synced',
        payloadSummary: { rowCount: params.length }
      });
    }

    res.json({ success: true, params: savedParams });
  } catch (error) {
    if (req.body?.clientRequestId) {
      const meetingName = Array.isArray(req.body?.params) && req.body.params.length > 0
        ? req.body.params[0].meetingName
        : null;
      await logSyncEvent(req, {
        operation: 'save-params',
        status: 'failed',
        clientRequestId: req.body.clientRequestId,
        meetingName,
        message: error.message,
        payloadSummary: { rowCount: req.body?.params?.length || 0 }
      });
    }
    console.error('Error saving params:', error);
    res.status(500).json({ error: error.message });
  }
});

// Bets API endpoints

// Get recent client names (last 6 unique)
app.get('/api/bets/recent-clients', async (req, res) => {
  try {
    const cached = cacheGet('recent-clients');
    if (cached) return res.json(cached);

    const recentClients = await Bets.aggregate([
      { $match: { clientName: { $exists: true, $ne: '' } } },
      { $sort: { betTime: -1 } },
      { $group: { 
        _id: '$clientName',
        firstBetTime: { $first: '$betTime' }
      }},
      { $sort: { firstBetTime: -1 } },
      { $limit: 6 },
      { $project: { _id: 0, clientName: '$_id' } }
    ]);
    const result = recentClients.map(item => item.clientName);
    cacheSet('recent-clients', result);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get last bet
app.get('/api/bets/last', async (req, res) => {
  try {
    const cached = cacheGet('bets:last');
    if (cached !== null) return res.json(cached);

    const lastBet = await Bets.findOne()
      .sort({ betTime: -1 })
      .select('-__v')
      .lean();
    const result = lastBet || null;
    cacheSet('bets:last', result);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all bets
app.get('/api/bets', async (req, res) => {
  try {
    const { meetingName } = req.query;
    const key = `bets:list:${meetingName || 'all'}`;
    const cached = cacheGet(key);
    if (cached) return res.json(cached);

    const query = meetingName ? { meetingName } : {};
    const bets = await Bets.find(query)
      .sort({ betTime: -1 })
      .select('-__v')
      .lean();
    cacheSet(key, bets);
    res.json(bets);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save a bet
app.post('/api/bets', async (req, res) => {
  try {
    if (req.body?.clientRequestId) {
      const existing = await Bets.findOne({ clientRequestId: req.body.clientRequestId }).lean();
      if (existing) {
        await logSyncEvent(req, {
          operation: 'create-bet',
          status: 'duplicate',
          clientRequestId: req.body.clientRequestId,
          meetingName: req.body.meetingName,
          message: 'Duplicate offline bet ignored',
          payloadSummary: {
            raceNum: req.body.raceNum,
            horseNum: req.body.horseNum,
            clientName: req.body.clientName
          }
        });
        return res.json({ success: true, bet: existing, duplicate: true });
      }
    }

    const bet = new Bets(req.body);
    const savedBet = await bet.save();
    cacheInvalidate('bets:', 'recent-clients');

    if (req.body?.clientRequestId) {
      await logSyncEvent(req, {
        operation: 'create-bet',
        status: 'synced',
        clientRequestId: req.body.clientRequestId,
        meetingName: req.body.meetingName,
        message: 'Offline bet synced',
        payloadSummary: {
          raceNum: req.body.raceNum,
          horseNum: req.body.horseNum,
          clientName: req.body.clientName
        }
      });
    }

    res.json({ success: true, bet: savedBet });
  } catch (error) {
    if (req.body?.clientRequestId) {
      await logSyncEvent(req, {
        operation: 'create-bet',
        status: 'failed',
        clientRequestId: req.body.clientRequestId,
        meetingName: req.body.meetingName,
        message: error.message,
        payloadSummary: {
          raceNum: req.body.raceNum,
          horseNum: req.body.horseNum,
          clientName: req.body.clientName
        }
      });
    }
    console.error('Error saving bet:', error);
    res.status(500).json({ error: error.message });
  }
});

// Sync audit log endpoint
app.get('/api/sync/audit', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const logs = await SyncAudit.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update bet cancelled status
app.patch('/api/bets/:id/cancel', async (req, res) => {
  try {
    const { cancelled } = req.body;
    const bet = await Bets.findByIdAndUpdate(
      req.params.id,
      { cancelled },
      { new: true }
    );
    cacheInvalidate('bets:');
    res.json({ success: true, bet });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update params (for winner, special, rule4 etc)
app.patch('/api/params/:id', async (req, res) => {
  try {
    const param = await Params.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    cacheInvalidate('params:');
    res.json({ success: true, param });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a bet
app.delete('/api/bets/:id', async (req, res) => {
  try {
    await Bets.findByIdAndDelete(req.params.id);
    cacheInvalidate('bets:', 'recent-clients');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a meeting (all data for a meeting)
app.delete('/api/meetings/:meetingName', async (req, res) => {
  try {
    const meetingName = decodeURIComponent(req.params.meetingName);
    
    // Delete from all collections
    const [initResult, paramsResult, betsResult] = await Promise.all([
      Init.deleteMany({ meetingName }),
      Params.deleteMany({ meetingName }),
      Bets.deleteMany({ meetingName })
    ]);
    
    // Invalidate all caches when a meeting is deleted
    cache.clear();
    res.json({ 
      success: true, 
      deleted: {
        init: initResult.deletedCount,
        params: paramsResult.deletedCount,
        bets: betsResult.deletedCount
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Add-On endpoints ────────────────────────────────────────────────────────
// GET all add-on values for a meeting
app.get('/api/reports/addon/:meetingName', authenticateToken, async (req, res) => {
  try {
    const meetingName = decodeURIComponent(req.params.meetingName);
    const addons = await Report.find({ meetingName }).lean();
    res.json(addons);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST upsert add-on for a specific client+meeting
app.post('/api/reports/addon', authenticateToken, async (req, res) => {
  try {
    const { meetingName, clientName, stake } = req.body;
    if (!meetingName || !clientName) {
      return res.status(400).json({ error: 'meetingName and clientName are required' });
    }
    const result = await Report.findOneAndUpdate(
      { meetingName, clientName },
      { meetingName, clientName, stake: stake || 0, horseName: 'AddOn', betTime: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE add-on for a specific client+meeting
app.delete('/api/reports/addon/:meetingName/:clientName', authenticateToken, async (req, res) => {
  try {
    const meetingName = decodeURIComponent(req.params.meetingName);
    const clientName = decodeURIComponent(req.params.clientName);
    await Report.deleteOne({ meetingName, clientName });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`ðŸš€ Server is running on port ${PORT}`);
  console.log(`ðŸ“ API URL: ${process.env.API_URL}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await mongoose.connection.close();
  console.log('MongoDB connection closed through app termination');
  process.exit(0);
});
