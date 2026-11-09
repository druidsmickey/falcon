const express = require('express');
const router = express.Router();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');
const WhatsappContact = require('../models/whatsappContact');
const whatsappInbox = require('../lib/whatsappInbox');
const { usableContacts, syncContacts } = require('../lib/contactSync');
const { sessionExists, autostartEnabled, shouldReconnect, removeStaleLocks } = require('../lib/whatsappAutostart');

let unreadSyncTimer = null;
function stopUnreadSync() {
  if (unreadSyncTimer) {
    clearInterval(unreadSyncTimer);
    unreadSyncTimer = null;
  }
}

let client = null;
let isReady = false;
let qrCodeData = null;
let clientStatus = 'disconnected';
// why the last start failed, shown on the WhatsApp tab
let lastError = '';
let initializationTimeout = null;

// Path to LocalAuth session data
const authPath = path.join(__dirname, '..', '.wwebjs_auth');

// Find Chrome/Chromium executable
function findChrome() {
  // CHROME_PATH in .env, else the Chrome that comes with puppeteer: a snap Chromium (the usual /usr/bin/chromium-browser
  // on Ubuntu) cannot use the hidden folder the session is kept in, and closes at once ("socket hang up")
  const preferred = [process.env.CHROME_PATH];
  try {
    preferred.push(require('puppeteer').executablePath());
  } catch (error) {
    // puppeteer has no browser of its own here: the system ones below are tried
  }
  for (const chromePath of preferred) {
    if (chromePath && fs.existsSync(chromePath)) {
      console.log('✅ Using Chrome at:', chromePath);
      return chromePath;
    }
  }

  const possiblePaths = [
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium',
    'chromium-browser',
    'chromium',
    'google-chrome',
    'google-chrome-stable'
  ];

  for (const chromePath of possiblePaths) {
    try {
      if (chromePath.startsWith('/')) {
        // Absolute path - check if file exists
        if (fs.existsSync(chromePath)) {
          console.log('✅ Found Chrome at:', chromePath);
          return chromePath;
        }
      } else {
        // Command - try to find with 'which'
        const result = execSync(`which ${chromePath}`, { encoding: 'utf8' }).trim();
        if (result) {
          console.log('✅ Found Chrome at:', result);
          return result;
        }
      }
    } catch (error) {
      // Continue to next path
    }
  }

  console.log('⚠️  Chrome not found in system paths, Puppeteer will try to use bundled version');
  return null;
}

// Clear LocalAuth session data
function clearAuthSession() {
  try {
    if (fs.existsSync(authPath)) {
      console.log('Clearing LocalAuth session data...');
      fs.rmSync(authPath, { recursive: true, force: true });
      console.log('LocalAuth session data cleared');
    }
  } catch (error) {
    console.error('Error clearing auth session:', error);
  }
}

// Connect again by itself: after a restart of the server, and after the connection was lost.
let reconnectTimer = null;
let startRetries = 0; // failed starts since the last time WhatsApp was ready: at most 5 are tried again by themselves
let browserDeaths = []; // when the browser died, for the last hour
function scheduleReconnect(seconds = 30) {
  if (reconnectTimer || !autostartEnabled() || !sessionExists(authPath)) return;
  console.log(`WhatsApp will connect again in ${seconds} seconds`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!client && sessionExists(authPath)) initializeClient();
  }, seconds * 1000);
}

/** Closes browsers that still run on the saved session (Linux only; nothing happens when there are none). */
function closeLeftoverBrowsers() {
  if (process.platform !== 'linux') return;
  try {
    execFileSync('pkill', ['-f', authPath], { stdio: 'ignore' });
    console.log('Closed a browser that was still running on the WhatsApp session');
  } catch (error) {
    // pkill finds nothing (exit code 1): the normal case
  }
}

// Initialize WhatsApp Client
function initializeClient() {
  if (client) {
    console.log('Client already exists, skipping initialization');
    return;
  }

  console.log('Starting WhatsApp client initialization...');
  clientStatus = 'initializing';
  lastError = '';
  qrCodeData = null;

  // Find Chrome executable
  const chromePath = findChrome();
  
  const puppeteerConfig = {
    headless: true,
    // the server closes the browser itself when it stops (see shutdown): a browser that is killed does not save the session
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'
    ]
  };

  // Use system Chrome if found
  if (chromePath) {
    puppeteerConfig.executablePath = chromePath;
  }

  // a browser left over from the server that was stopped still holds the session: the new one would be closed at once
  // ("Navigating frame was detached"), so it is closed first
  closeLeftoverBrowsers();
  removeStaleLocks(authPath);
  client = new Client({
    authStrategy: new LocalAuth({
      clientId: 'itb-whatsapp-client',
      dataPath: authPath
    }),
    puppeteer: puppeteerConfig
  });

  // read the bets sent by the contacts that were chosen (they wait in the inbox until confirmed)
  whatsappInbox.attach(client);

  console.log('WhatsApp client created with config:', {
    hasExecutablePath: !!chromePath,
    executablePath: chromePath || 'using bundled Chrome'
  });

  // Set timeout for initialization (3 minutes for slower servers)
  if (initializationTimeout) {
    clearTimeout(initializationTimeout);
  }
  initializationTimeout = setTimeout(() => {
    if (!isReady && client) {
      console.error('⏰ WhatsApp initialization timeout after 3 minutes');
      console.error('Current status:', clientStatus);
      console.error('QR Code exists:', !!qrCodeData);
      clientStatus = 'timeout';
      lastError = 'WhatsApp did not answer within 3 minutes';
      qrCodeData = null;
      if (client) {
        client.destroy().catch(console.error);
        client = null;
      }
    }
  }, 180000); // 3 minutes (increased for slower servers)

  client.on('loading_screen', (percent, message) => {
    console.log('Loading screen:', percent, message);
    // WhatsApp Web shows its loading screen again from time to time: that is no reason to say it is not connected
    if (!isReady) clientStatus = 'loading';
  });

  client.on('qr', (qr) => {
    console.log('✅ QR Code received! Length:', qr?.length);
    console.log('QR Code preview:', qr?.substring(0, 50) + '...');
    qrCodeData = qr;
    clientStatus = 'qr_code';
    qrcode.generate(qr, { small: true });
  });

  const thisClient = client;
  client.on('ready', () => {
    console.log('✅ WhatsApp Client is ready!');
    startRetries = 0;
    // when the browser dies (it was killed, or crashed) no event tells the library: without this the tab keeps saying
    // "connected" and the bets stop arriving
    const browser = thisClient.pupBrowser;
    if (browser && typeof browser.on === 'function') {
      browser.on('disconnected', () => {
        if (client !== thisClient) return; // stopped on purpose
        console.log('⚠️  The browser of WhatsApp closed: connecting again');
        stopUnreadSync();
        isReady = false;
        clientStatus = 'disconnected';
        client = null;
        qrCodeData = null;
        thisClient.destroy().catch(() => {});
        // at most 5 times an hour: a browser that keeps dying must not be started again and again
        browserDeaths = browserDeaths.filter(at => Date.now() - at < 3600000);
        browserDeaths.push(Date.now());
        if (browserDeaths.length <= 5) scheduleReconnect(15);
        else console.log("The browser of WhatsApp keeps closing: not connecting again by itself, press Initialize");
      });
    }
    isReady = true;
    clientStatus = 'ready';
    qrCodeData = null;
    if (initializationTimeout) {
      clearTimeout(initializationTimeout);
      initializationTimeout = null;
    }
    
    // The chats are not loaded in the background any more: loading every chat is heavy for the browser, and the Inbox does
    // not need it (it reads the contacts that were ticked). A chat is kept unread only when it is marked on purpose.
    stopUnreadSync();
  });

  client.on('authenticated', () => {
    console.log('✅ WhatsApp Client authenticated');
    clientStatus = 'authenticated';
  });

  client.on('auth_failure', (msg) => {
    console.error('❌ WhatsApp authentication failure:', msg);
    stopUnreadSync();
    clientStatus = 'auth_failure';
    qrCodeData = null;
    if (initializationTimeout) {
      clearTimeout(initializationTimeout);
      initializationTimeout = null;
    }
    // Clear the session on auth failure so next initialization will generate new QR
    console.log('Clearing session for fresh QR code...');
    if (client) {
      client.destroy().catch(console.error);
      client = null;
    }
    clearAuthSession();
  });

  client.on('disconnected', (reason) => {
    console.log('⚠️  WhatsApp Client disconnected:', reason);
    stopUnreadSync();
    isReady = false;
    clientStatus = 'disconnected';
    client = null;
    qrCodeData = null;
    if (initializationTimeout) {
      clearTimeout(initializationTimeout);
      initializationTimeout = null;
    }
    // a lost connection is taken up again by itself (unless the phone logged this device out)
    if (shouldReconnect(reason)) scheduleReconnect();
  });

  console.log('📱 Calling client.initialize()...');
  const starting = client;
  client.initialize().catch((error) => {
    console.error('❌ Client initialization error:', error);
    console.error('Error stack:', error.stack);
    clientStatus = 'error';
    lastError = String((error && error.message) || error).slice(0, 300);
    qrCodeData = null;
    client = null;
    // close a browser that was half started, so that it does not block the next try
    starting.destroy().catch(() => {});
    // a start that fails (for example in the middle of a restart) is tried again by itself while a saved session exists
    if (startRetries++ < 5) scheduleReconnect(30);
    if (initializationTimeout) {
      clearTimeout(initializationTimeout);
      initializationTimeout = null;
    }
  });
}

// GET: Get WhatsApp status and QR code
router.get('/status', (req, res) => {
  console.log('Status check - clientStatus:', clientStatus, 'isReady:', isReady, 'hasQR:', !!qrCodeData);
  res.json({
    status: clientStatus,
    isReady,
    qrCode: qrCodeData,
    error: clientStatus === 'error' || clientStatus === 'timeout' ? lastError : '',
    debug: {
      clientExists: !!client,
      authPathExists: fs.existsSync(authPath),
      timestamp: new Date().toISOString()
    }
  });
});

// POST: Initialize WhatsApp client
router.post('/initialize', (req, res) => {
  try {
    if (client && isReady) {
      return res.json({ success: true, message: 'Client already initialized and ready' });
    }
    
    if (client && !isReady) {
      return res.json({ success: true, message: 'Client initialization in progress' });
    }

    initializeClient();
    res.json({ success: true, message: 'WhatsApp client initialization started' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST: Disconnect WhatsApp client
router.post('/disconnect', async (req, res) => {
  try {
    stopUnreadSync();
    if (initializationTimeout) {
      clearTimeout(initializationTimeout);
      initializationTimeout = null;
    }
    if (client) {
      const current = client;
      // a browser that is already gone must not keep the tab from being disconnected
      client = null;
      isReady = false;
      clientStatus = 'disconnected';
      qrCodeData = null;
      await current.destroy().catch(error => console.log('Closing the browser:', error.message));
    }
    res.json({ success: true, message: 'WhatsApp client disconnected' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST: Force re-initialization (clears session and generates new QR)
router.post('/reset', async (req, res) => {
  try {
    console.log('Force reset requested - clearing session...');
    stopUnreadSync();
    
    if (initializationTimeout) {
      clearTimeout(initializationTimeout);
      initializationTimeout = null;
    }
    
    // Destroy existing client
    if (client) {
      await client.destroy();
      client = null;
    }
    
    // Clear session data
    clearAuthSession();
    
    // Reset state
    isReady = false;
    clientStatus = 'disconnected';
    qrCodeData = null;
    
    // Wait a bit for cleanup
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Re-initialize
    initializeClient();
    
    res.json({ 
      success: true, 
      message: 'Session cleared and re-initialization started. New QR code will be generated.' 
    });
  } catch (error) {
    console.error('Reset error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET: Test Puppeteer (debugging endpoint)
router.get('/test-puppeteer', async (req, res) => {
  try {
    console.log('Testing Puppeteer launch...');
    const puppeteer = require('puppeteer');
    
    // Find Chrome using same logic as WhatsApp client
    const chromePath = findChrome();
    
    const launchConfig = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    };

    if (chromePath) {
      launchConfig.executablePath = chromePath;
    }

    console.log('Launching with config:', launchConfig);
    const browser = await puppeteer.launch(launchConfig);
    
    console.log('✅ Puppeteer launched successfully!');
    const version = await browser.version();
    await browser.close();
    
    res.json({
      success: true,
      message: 'Puppeteer can launch successfully',
      browserVersion: version,
      chromePath: chromePath || 'using bundled Chrome',
      authPathExists: fs.existsSync(authPath),
      authPath: authPath
    });
  } catch (error) {
    console.error('❌ Puppeteer test failed:', error);
    
    // More helpful error message
    let suggestion = 'Install Chromium browser. See DIGITAL_OCEAN_SETUP.md';
    if (error.message.includes('Could not find Chrome')) {
      suggestion = 'Run: sudo apt-get update && sudo apt-get install -y chromium-browser';
    }
    
    res.status(500).json({
      success: false,
      error: error.message,
      suggestion: suggestion
    });
  }
});

// GET: Get all contacts (from MongoDB)
router.get('/contacts', async (req, res) => {
  try {
    const contacts = await WhatsappContact.find().sort({ name: 1 });
    res.json({ 
      contacts: contacts.map(c => ({
        id: c._id.toString(),
        name: c.name,
        number: c.number,
        createdAt: c.createdAt
      }))
    });
  } catch (error) {
    console.error('Error loading contacts:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET: Fetch contacts from WhatsApp
router.get('/whatsapp-contacts', async (req, res) => {
  try {
    if (!client || !isReady) {
      return res.status(400).json({ error: 'WhatsApp client is not ready' });
    }

    const whatsappContacts = await client.getContacts();
    
    // Filter out groups and only return individual contacts with names
    const individualContacts = whatsappContacts
      .filter(contact => 
        contact.isUser && // Only individual users, not groups
        !contact.isMe && // Exclude yourself
        contact.name && // Has a name
        contact.id && 
        contact.id._serialized // Has a valid ID
      )
      .map(contact => ({
        name: contact.name || contact.pushname || contact.number,
        number: contact.id._serialized,
        isWhatsAppContact: true
      }))
      .sort((a, b) => a.name.localeCompare(b.name)); // Sort alphabetically

    res.json({ 
      success: true, 
      contacts: individualContacts,
      count: individualContacts.length 
    });
  } catch (error) {
    console.error('Error fetching WhatsApp contacts:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST: Copy all the contacts of the phone into the saved contacts (existing ones keep their nickname and listen choice)
router.post('/sync-contacts', async (req, res) => {
  try {
    if (!client || !isReady) {
      return res.status(400).json({ error: 'WhatsApp is not connected' });
    }
    const result = await syncContacts(usableContacts(await client.getContacts()));
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error syncing contacts:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST: Import contacts from WhatsApp to MongoDB
router.post('/import-contacts', async (req, res) => {
  try {
    if (!client || !isReady) {
      return res.status(400).json({ error: 'WhatsApp client is not ready' });
    }

    const { selectedNumbers } = req.body;

    if (!selectedNumbers || !Array.isArray(selectedNumbers)) {
      return res.status(400).json({ error: 'Selected numbers array is required' });
    }

    console.log('Importing contacts:', selectedNumbers.length, 'selected');

    const whatsappContacts = await client.getContacts();
    console.log('Total WhatsApp contacts available:', whatsappContacts.length);
    
    let importedCount = 0;
    let skippedCount = 0;
    let notFoundCount = 0;
    const imported = [];
    const skipped = [];

    for (const number of selectedNumbers) {
      const whatsappContact = whatsappContacts.find(c => c.id && c.id._serialized === number);
      
      if (!whatsappContact) {
        console.log('Contact not found for number:', number);
        notFoundCount++;
        continue;
      }

      // Check if contact already exists
      const existingContact = await WhatsappContact.findOne({ number });
      if (existingContact) {
        console.log('Contact already exists:', number);
        skipped.push({ number, name: whatsappContact.name || whatsappContact.pushname });
        skippedCount++;
        continue;
      }

      const newContact = await WhatsappContact.create({
        name: whatsappContact.name || whatsappContact.pushname || whatsappContact.number || 'Unknown',
        number: number
      });
      
      imported.push({
        id: newContact._id.toString(),
        name: newContact.name,
        number: newContact.number,
        createdAt: newContact.createdAt
      });
      importedCount++;
      console.log('Imported contact:', newContact.name, newContact.number);
    }

    console.log(`Import summary: ${importedCount} imported, ${skippedCount} skipped, ${notFoundCount} not found`);

    res.json({ 
      success: true, 
      message: `Imported ${importedCount} contact(s)${skippedCount > 0 ? `, ${skippedCount} already existed` : ''}`,
      imported,
      skipped,
      count: importedCount,
      skippedCount,
      notFoundCount
    });
  } catch (error) {
    console.error('Error importing contacts:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST: Add a contact manually
router.post('/contacts', async (req, res) => {
  try {
    const { name, number } = req.body;
    
    if (!name || !number) {
      return res.status(400).json({ error: 'Name and number are required' });
    }

    // Format number: remove spaces, dashes, and ensure it has country code
    let formattedNumber = number.replace(/[\s-]/g, '');
    if (!formattedNumber.includes('@')) {
      formattedNumber = formattedNumber + '@c.us';
    }

    const existingContact = await WhatsappContact.findOne({ number: formattedNumber });
    if (existingContact) {
      return res.status(400).json({ error: 'Contact already exists' });
    }

    const newContact = await WhatsappContact.create({
      name,
      number: formattedNumber
    });

    res.json({ 
      success: true, 
      contact: {
        id: newContact._id.toString(),
        name: newContact.name,
        number: newContact.number,
        createdAt: newContact.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE: Remove a contact
router.delete('/contacts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const contact = await WhatsappContact.findByIdAndDelete(id);
    
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    res.json({ success: true, message: 'Contact deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// After a restart the saved session is taken up again, so that the inbox works without pressing Initialize
if (autostartEnabled() && sessionExists(authPath)) {
  console.log('A saved WhatsApp session was found: connecting in 10 seconds');
  scheduleReconnect(10);
}

/**
 * Closes WhatsApp the proper way when the server stops (every deploy restarts it): the browser then saves the
 * logged-in session, so that no QR code has to be scanned again.
 */
router.shutdown = async function shutdown(timeoutMs = 15000) {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  stopUnreadSync();
  const current = client;
  client = null;
  if (!current) return;
  await Promise.race([
    current.destroy().catch(() => {}),
    new Promise(resolve => setTimeout(resolve, timeoutMs)),
  ]);
};

module.exports = router;
