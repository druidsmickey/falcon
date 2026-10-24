const express = require('express');
const router = express.Router();
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const multer = require('multer');
const WhatsappContact = require('../models/whatsappContact');
const WhatsappGroup = require('../models/whatsappGroup');
const WhatsappMessage = require('../models/whatsappMessage');

// Configure multer for memory storage with 50MB limit
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// Group names are compared as text, so characters that mean something in a pattern are escaped
const escapeRegex = text => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let client = null;
let isReady = false;
let qrCodeData = null;
let clientStatus = 'disconnected';
let initializationTimeout = null;

// Track chats that should remain unread
const chatsToKeepUnread = new Set();

// Batch sending configuration
const BATCH_SIZE = 7; // Send 7 messages at a time
const BATCH_DELAY = 1000; // 1 second delay between batches

// Path to LocalAuth session data
const authPath = path.join(__dirname, '..', '.wwebjs_auth');

// Helper function to send messages in batches
async function sendInBatches(items, sendFunction) {
  const results = [];
  
  // Split items into batches of BATCH_SIZE
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    
    // Send all messages in current batch in parallel
    const batchPromises = batch.map(item => sendFunction(item));
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    
    // Wait before next batch (except for last batch)
    if (i + BATCH_SIZE < items.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
    }
  }
  
  return results;
}

// Find Chrome/Chromium executable
function findChrome() {
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

// Initialize WhatsApp Client
function initializeClient() {
  if (client) {
    console.log('Client already exists, skipping initialization');
    return;
  }

  console.log('Starting WhatsApp client initialization...');
  clientStatus = 'initializing';
  qrCodeData = null;

  // Find Chrome executable
  const chromePath = findChrome();
  
  const puppeteerConfig = {
    headless: true,
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

  client = new Client({
    authStrategy: new LocalAuth({
      clientId: 'itb-whatsapp-client',
      dataPath: authPath
    }),
    puppeteer: puppeteerConfig
  });

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
      qrCodeData = null;
      if (client) {
        client.destroy().catch(console.error);
        client = null;
      }
    }
  }, 180000); // 3 minutes (increased for slower servers)

  client.on('loading_screen', (percent, message) => {
    console.log('Loading screen:', percent, message);
    clientStatus = 'loading';
  });

  client.on('qr', (qr) => {
    console.log('✅ QR Code received! Length:', qr?.length);
    console.log('QR Code preview:', qr?.substring(0, 50) + '...');
    qrCodeData = qr;
    clientStatus = 'qr_code';
    qrcode.generate(qr, { small: true });
  });

  client.on('ready', () => {
    console.log('✅ WhatsApp Client is ready!');
    isReady = true;
    clientStatus = 'ready';
    qrCodeData = null;
    if (initializationTimeout) {
      clearTimeout(initializationTimeout);
      initializationTimeout = null;
    }
    
    // Sync unread chats periodically (every 30 seconds)
    setInterval(async () => {
      try {
        const chats = await client.getChats();
        for (const chat of chats) {
          if (chat.unreadCount > 0) {
            // Add chats with unread messages to tracking
            chatsToKeepUnread.add(chat.id._serialized);
          }
        }
      } catch (err) {
        console.log('Error syncing unread chats:', err.message);
      }
    }, 30000);
  });

  client.on('authenticated', () => {
    console.log('✅ WhatsApp Client authenticated');
    clientStatus = 'authenticated';
  });

  client.on('auth_failure', (msg) => {
    console.error('❌ WhatsApp authentication failure:', msg);
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
    isReady = false;
    clientStatus = 'disconnected';
    client = null;
    qrCodeData = null;
    if (initializationTimeout) {
      clearTimeout(initializationTimeout);
      initializationTimeout = null;
    }
  });

  console.log('📱 Calling client.initialize()...');
  client.initialize().catch((error) => {
    console.error('❌ Client initialization error:', error);
    console.error('Error stack:', error.stack);
    clientStatus = 'error';
    qrCodeData = null;
    client = null;
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
    debug: {
      clientExists: !!client,
      authPathExists: fs.existsSync(authPath),
      timestamp: new Date().toISOString()
    }
  });
});

// POST: Mark a chat to keep unread
router.post('/mark-keep-unread', async (req, res) => {
  try {
    const { contactNumber } = req.body;
    
    if (!contactNumber) {
      return res.status(400).json({ error: 'Contact number is required' });
    }
    
    chatsToKeepUnread.add(contactNumber);
    
    // Immediately mark as unread if client is ready
    if (client && isReady) {
      try {
        const chat = await client.getChatById(contactNumber);
        await chat.markUnread();
      } catch (err) {
        console.log('Could not mark chat as unread:', err.message);
      }
    }
    
    res.json({ 
      success: true, 
      message: 'Chat will be kept unread',
      trackedChats: Array.from(chatsToKeepUnread)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST: Remove a chat from keep unread list
router.post('/unmark-keep-unread', (req, res) => {
  try {
    const { contactNumber } = req.body;
    
    if (!contactNumber) {
      return res.status(400).json({ error: 'Contact number is required' });
    }
    
    chatsToKeepUnread.delete(contactNumber);
    
    res.json({ 
      success: true, 
      message: 'Chat removed from keep unread list',
      trackedChats: Array.from(chatsToKeepUnread)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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
    if (initializationTimeout) {
      clearTimeout(initializationTimeout);
      initializationTimeout = null;
    }
    if (client) {
      await client.destroy();
      client = null;
      isReady = false;
      clientStatus = 'disconnected';
      qrCodeData = null;
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
      stack: error.stack,
      suggestion: suggestion,
      triedPaths: [
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable'
      ]
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

    // Also remove this contact from all groups
    await WhatsappGroup.updateMany(
      { contactIds: id },
      { $pull: { contactIds: id } }
    );

    res.json({ success: true, message: 'Contact deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST: Send message to a contact
router.post('/send-message', async (req, res) => {
  try {
    if (!client || !isReady) {
      return res.status(400).json({ error: 'WhatsApp client is not ready. Please initialize first.' });
    }

    const { contactId, message } = req.body;

    if (!contactId || !message) {
      return res.status(400).json({ error: 'Contact ID and message are required' });
    }

    const contact = await WhatsappContact.findById(contactId);
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    // Check if chat should be kept unread
    let shouldKeepUnread = false;
    try {
      const chatBefore = await client.getChatById(contact.number);
      if (chatBefore) {
        // Check if has unread messages
        if (chatBefore.unreadCount > 0) {
          shouldKeepUnread = true;
          chatsToKeepUnread.add(contact.number);
        }
        // Also check if it's in our tracked set
        else if (chatsToKeepUnread.has(contact.number)) {
          shouldKeepUnread = true;
        }
      }
    } catch (err) {
      // Check if we're tracking this chat
      if (chatsToKeepUnread.has(contact.number)) {
        shouldKeepUnread = true;
      }
    }

    await client.sendMessage(contact.number, message);
    
    // Mark as unread if needed
    if (shouldKeepUnread) {
      setTimeout(async () => {
        try {
          const chat = await client.getChatById(contact.number);
          await chat.markUnread();
        } catch (unreadError) {
          console.log(`Could not mark chat as unread for ${contact.name}:`, unreadError.message);
        }
      }, 500);
    }
    
    res.json({ 
      success: true, 
      message: 'Message sent successfully',
      sentTo: contact.name
    });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST: Send bulk messages to multiple contacts
router.post('/send-bulk', async (req, res) => {
  try {
    if (!client || !isReady) {
      return res.status(400).json({ error: 'WhatsApp client is not ready. Please initialize first.' });
    }

    const { contactIds, message } = req.body;

    if (!contactIds || !Array.isArray(contactIds) || contactIds.length === 0) {
      return res.status(400).json({ error: 'Contact IDs array is required' });
    }

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Send messages in batches (7 at a time with 1s delay)
    const results = await sendInBatches(contactIds, async (contactId) => {
      const contact = await WhatsappContact.findById(contactId);
      if (!contact) {
        return { contactId, success: false, error: 'Contact not found' };
      }

      try {
        // Check if chat should be kept unread
        let shouldKeepUnread = false;
        try {
          const chatBefore = await client.getChatById(contact.number);
          if (chatBefore) {
            // Check if has unread messages
            if (chatBefore.unreadCount > 0) {
              shouldKeepUnread = true;
              chatsToKeepUnread.add(contact.number);
            }
            // Also check if it's in our tracked set
            else if (chatsToKeepUnread.has(contact.number)) {
              shouldKeepUnread = true;
            }
          }
        } catch (err) {
          // Check if we're tracking this chat
          if (chatsToKeepUnread.has(contact.number)) {
            shouldKeepUnread = true;
          }
        }

        await client.sendMessage(contact.number, message);
        
        // Mark as unread if needed
        if (shouldKeepUnread) {
          setTimeout(async () => {
            try {
              const chat = await client.getChatById(contact.number);
              await chat.markUnread();
            } catch (unreadError) {
              console.log(`Could not mark chat as unread for ${contact.name}:`, unreadError.message);
            }
          }, 500);
        }
        
        return { 
          contactId, 
          name: contact.name,
          success: true 
        };
      } catch (error) {
        return { 
          contactId, 
          name: contact.name,
          success: false, 
          error: error.message 
        };
      }
    });

    res.json({ 
      success: true, 
      message: 'Bulk messages processed',
      results 
    });
  } catch (error) {
    console.error('Error sending bulk messages:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST: Send formatted betting report
router.post('/send-report', async (req, res) => {
  try {
    if (!client || !isReady) {
      return res.status(400).json({ error: 'WhatsApp client is not ready. Please initialize first.' });
    }

    const { contactId, reportData } = req.body;

    if (!contactId || !reportData) {
      return res.status(400).json({ error: 'Contact ID and report data are required' });
    }

    const contact = await WhatsappContact.findById(contactId);
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    // Format the report message
    let formattedMessage = `*${reportData.title || 'Betting Report'}*\n\n`;
    
    if (reportData.meeting) {
      formattedMessage += `📅 Meeting: ${reportData.meeting}\n`;
    }
    
    if (reportData.date) {
      formattedMessage += `📆 Date: ${reportData.date}\n`;
    }
    
    formattedMessage += `\n`;
    
    if (reportData.races && Array.isArray(reportData.races)) {
      reportData.races.forEach((race, index) => {
        formattedMessage += `🏇 *Race ${index + 1}*\n`;
        if (race.winner) formattedMessage += `Winner: ${race.winner}\n`;
        if (race.totalBets) formattedMessage += `Total Bets: ${race.totalBets}\n`;
        if (race.totalPayout) formattedMessage += `Total Payout: ${race.totalPayout}\n`;
        formattedMessage += `\n`;
      });
    }
    
    if (reportData.summary) {
      formattedMessage += `📊 *Summary*\n`;
      formattedMessage += reportData.summary + `\n`;
    }
    
    if (reportData.footer) {
      formattedMessage += `\n${reportData.footer}`;
    }

    // Check if chat should be kept unread
    let shouldKeepUnread = false;
    try {
      const chatBefore = await client.getChatById(contact.number);
      if (chatBefore) {
        // Check if has unread messages
        if (chatBefore.unreadCount > 0) {
          shouldKeepUnread = true;
          chatsToKeepUnread.add(contact.number);
        }
        // Also check if it's in our tracked set
        else if (chatsToKeepUnread.has(contact.number)) {
          shouldKeepUnread = true;
        }
      }
    } catch (err) {
      // Check if we're tracking this chat
      if (chatsToKeepUnread.has(contact.number)) {
        shouldKeepUnread = true;
      }
    }

    await client.sendMessage(contact.number, formattedMessage);
    
    // Mark as unread if needed
    if (shouldKeepUnread) {
      setTimeout(async () => {
        try {
          const chat = await client.getChatById(contact.number);
          await chat.markUnread();
        } catch (unreadError) {
          console.log(`Could not mark chat as unread for ${contact.name}:`, unreadError.message);
        }
      }, 500);
    }
    
    res.json({ 
      success: true, 
      message: 'Report sent successfully',
      sentTo: contact.name
    });
  } catch (error) {
    console.error('Error sending report:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== GROUP MANAGEMENT ====================

// GET: Get all groups
router.get('/groups', async (req, res) => {
  try {
    const groups = await WhatsappGroup.find().sort({ name: 1 });
    res.json({ 
      success: true,
      groups: groups.map(group => ({
        id: group._id.toString(),
        name: group.name,
        contactIds: group.contactIds.map(id => id.toString()),
        contactCount: group.contactIds.length,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt
      }))
    });
  } catch (error) {
    console.error('Error loading groups:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST: Create a new group
router.post('/groups', async (req, res) => {
  try {
    const { name, contactIds } = req.body;
    
    console.log('Creating group:', name);
    console.log('Received contact IDs:', contactIds);
    
    if (!name) {
      return res.status(400).json({ error: 'Group name is required' });
    }

    if (!contactIds || !Array.isArray(contactIds)) {
      return res.status(400).json({ error: 'Contact IDs array is required' });
    }

    // Check if group name already exists
    const existingGroup = await WhatsappGroup.findOne({ name: { $regex: new RegExp(`^${escapeRegex(name)}$`, 'i') } });
    if (existingGroup) {
      return res.status(400).json({ error: 'Group name already exists' });
    }

    // Validate contact IDs exist
    const validContactIds = [];
    for (const id of contactIds) {
      const contact = await WhatsappContact.findById(id);
      if (contact) {
        validContactIds.push(id);
      } else {
        console.log('Contact ID not found:', id);
      }
    }

    console.log('Valid contact IDs after filtering:', validContactIds);

    const newGroup = await WhatsappGroup.create({
      name,
      contactIds: validContactIds
    });
    
    console.log('Group created:', newGroup);
    
    res.json({ 
      success: true, 
      message: 'Group created successfully',
      group: {
        id: newGroup._id.toString(),
        name: newGroup.name,
        contactIds: newGroup.contactIds.map(id => id.toString()),
        contactCount: newGroup.contactIds.length,
        createdAt: newGroup.createdAt,
        updatedAt: newGroup.updatedAt
      }
    });
  } catch (error) {
    console.error('Error creating group:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT: Update a group
router.put('/groups/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, contactIds } = req.body;

    console.log('Updating group:', id);
    console.log('New name:', name);
    console.log('New contact IDs:', contactIds);

    const group = await WhatsappGroup.findById(id);
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    console.log('Current group:', group);

    if (name) {
      // Check if new name conflicts with another group
      const duplicate = await WhatsappGroup.findOne({ 
        _id: { $ne: id },
        name: { $regex: new RegExp(`^${escapeRegex(name)}$`, 'i') }
      });
      if (duplicate) {
        return res.status(400).json({ error: 'Group name already exists' });
      }
      group.name = name;
    }

    if (contactIds && Array.isArray(contactIds)) {
      // Validate contact IDs
      const validContactIds = [];
      for (const cid of contactIds) {
        const contact = await WhatsappContact.findById(cid);
        if (contact) {
          validContactIds.push(cid);
        } else {
          console.log('Contact ID not found during update:', cid);
        }
      }
      group.contactIds = validContactIds;
      console.log('Updated group contact IDs:', group.contactIds);
    }

    group.updatedAt = new Date();
    await group.save();

    console.log('Group after update:', group);

    res.json({ 
      success: true, 
      message: 'Group updated successfully',
      group: {
        id: group._id.toString(),
        name: group.name,
        contactIds: group.contactIds.map(id => id.toString()),
        contactCount: group.contactIds.length,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt
      }
    });
  } catch (error) {
    console.error('Error updating group:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE: Delete a group
router.delete('/groups/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const group = await WhatsappGroup.findByIdAndDelete(id);
    
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    res.json({ success: true, message: 'Group deleted successfully' });
  } catch (error) {
    console.error('Error deleting group:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST: Send message to all contacts in a group
router.post('/send-to-group', async (req, res) => {
  try {
    if (!client || !isReady) {
      return res.status(400).json({ error: 'WhatsApp client is not ready. Please initialize first.' });
    }

    const { groupId, message } = req.body;

    if (!groupId || !message) {
      return res.status(400).json({ error: 'Group ID and message are required' });
    }

    const group = await WhatsappGroup.findById(groupId);
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    if (group.contactIds.length === 0) {
      return res.status(400).json({ error: 'Group has no contacts' });
    }

    const messageIds = [];
    
    // Send messages in batches (7 at a time with 1s delay)
    const results = await sendInBatches(group.contactIds, async (contactId) => {
      const contact = await WhatsappContact.findById(contactId);
      if (!contact) {
        return { contactId: contactId.toString(), success: false, error: 'Contact not found' };
      }

      try {
        // Check if chat should be kept unread
        let shouldKeepUnread = false;
        try {
          const chatBefore = await client.getChatById(contact.number);
          if (chatBefore) {
            // Check if has unread messages
            if (chatBefore.unreadCount > 0) {
              shouldKeepUnread = true;
              chatsToKeepUnread.add(contact.number);
            }
            // Also check if it's in our tracked set
            else if (chatsToKeepUnread.has(contact.number)) {
              shouldKeepUnread = true;
            }
          }
        } catch (err) {
          // Check if we're tracking this chat
          if (chatsToKeepUnread.has(contact.number)) {
            shouldKeepUnread = true;
          }
        }

        const sentMessage = await client.sendMessage(contact.number, message);

        // Mark as unread if needed
        if (shouldKeepUnread) {
          setTimeout(async () => {
            try {
              const chat = await client.getChatById(contact.number);
              await chat.markUnread();
            } catch (unreadError) {
              console.log(`Could not mark chat as unread for ${contact.name}:`, unreadError.message);
            }
          }, 500);
        }

        // Store message ID for potential deletion
        messageIds.push({
          contactId: contactId,
          contactName: contact.name,
          whatsappMessageId: sentMessage.id._serialized,
          chatId: contact.number,
          timestamp: sentMessage.timestamp
        });
        
        return { 
          contactId: contactId.toString(), 
          name: contact.name,
          success: true 
        };
      } catch (error) {
        return { 
          contactId: contactId.toString(), 
          name: contact.name,
          success: false, 
          error: error.message 
        };
      }
    });

    const successCount = results.filter(r => r.success).length;

    // Save message to database for history
    const savedMessage = await WhatsappMessage.create({
      groupId,
      groupName: group.name,
      message,
      messageIds
    });

    res.json({ 
      success: true, 
      message: `Sent to ${successCount}/${results.length} contacts in group "${group.name}"`,
      groupName: group.name,
      messageId: savedMessage._id.toString(),
      results 
    });
  } catch (error) {
    console.error('Error sending message to group:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET: Get message history for a group
router.get('/messages/:groupId', async (req, res) => {
  try {
    const { groupId } = req.params;
    const limit = parseInt(req.query.limit) || 50;

    const messages = await WhatsappMessage.find({ groupId })
      .sort({ sentAt: -1 })
      .limit(limit)
      .lean();

    res.json({
      success: true,
      messages: messages.map(msg => ({
        id: msg._id.toString(),
        message: msg.message,
        sentAt: msg.sentAt,
        contactCount: msg.messageIds.length
      }))
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST: Delete selected messages
router.post('/delete-messages', async (req, res) => {
  try {
    if (!client || !isReady) {
      return res.status(400).json({ error: 'WhatsApp client is not ready. Please initialize first.' });
    }

    const { messageIds } = req.body;

    if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({ error: 'Message IDs array is required' });
    }

    let totalDeleted = 0;
    const deletionResults = [];

    for (const msgId of messageIds) {
      try {
        const messageDoc = await WhatsappMessage.findById(msgId);
        
        if (!messageDoc) {
          deletionResults.push({
            messageId: msgId,
            success: false,
            error: 'Message not found in database'
          });
          continue;
        }

        let deletedFromContacts = 0;

        // Delete from each contact's chat
        for (const msgInfo of messageDoc.messageIds) {
          try {
            const chat = await client.getChatById(msgInfo.chatId);
            const messages = await chat.fetchMessages({ limit: 100 });
            
            // Find message by ID
            const message = messages.find(m => m.id._serialized === msgInfo.whatsappMessageId);
            
            if (message) {
              await message.delete(true); // true = delete for everyone
              deletedFromContacts++;
            }

            await new Promise(resolve => setTimeout(resolve, 300));
          } catch (error) {
            console.error(`Failed to delete from ${msgInfo.contactName}:`, error.message);
          }
        }

        // Remove from database
        await WhatsappMessage.findByIdAndDelete(msgId);

        deletionResults.push({
          messageId: msgId,
          success: true,
          deletedFromContacts,
          totalContacts: messageDoc.messageIds.length,
          message: messageDoc.message.substring(0, 50) + '...'
        });

        totalDeleted++;

        // Wait 1 second between each message to avoid rate limiting
        if (totalDeleted < messageIds.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        deletionResults.push({
          messageId: msgId,
          success: false,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      message: `Deleted ${totalDeleted} of ${messageIds.length} message(s)`,
      totalDeleted,
      results: deletionResults
    });
  } catch (error) {
    console.error('Error deleting messages:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST: Send image to group
router.post('/send-image-to-group', upload.single('image'), async (req, res) => {
  try {
    if (!client || !isReady) {
      return res.status(400).json({ error: 'WhatsApp client is not ready. Please initialize first.' });
    }

    const { groupId, caption } = req.body;
    const imageFile = req.file;

    if (!groupId) {
      return res.status(400).json({ error: 'Group ID is required' });
    }

    if (!imageFile) {
      return res.status(400).json({ error: 'Image file is required' });
    }

    const group = await WhatsappGroup.findById(groupId);
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    if (group.contactIds.length === 0) {
      return res.status(400).json({ error: 'Group has no contacts' });
    }

    // Create MessageMedia from buffer
    const media = new MessageMedia(
      imageFile.mimetype,
      imageFile.buffer.toString('base64'),
      imageFile.originalname
    );

    const messageIds = [];
    
    // Send images in batches (7 at a time with 1s delay)
    const results = await sendInBatches(group.contactIds, async (contactId) => {
      const contact = await WhatsappContact.findById(contactId);
      if (!contact) {
        return { 
          contactId: contactId.toString(), 
          success: false, 
          error: 'Contact not found' 
        };
      }

      try {
        // Check if chat should be kept unread
        let shouldKeepUnread = false;
        try {
          const chatBefore = await client.getChatById(contact.number);
          if (chatBefore) {
            // Check if has unread messages
            if (chatBefore.unreadCount > 0) {
              shouldKeepUnread = true;
              chatsToKeepUnread.add(contact.number);
            }
            // Also check if it's in our tracked set
            else if (chatsToKeepUnread.has(contact.number)) {
              shouldKeepUnread = true;
            }
          }
        } catch (err) {
          // Check if we're tracking this chat
          if (chatsToKeepUnread.has(contact.number)) {
            shouldKeepUnread = true;
          }
        }

        const sentMessage = await client.sendMessage(contact.number, media, { caption: caption || '' });
        
        // Mark as unread if needed
        if (shouldKeepUnread) {
          setTimeout(async () => {
            try {
              const chat = await client.getChatById(contact.number);
              await chat.markUnread();
            } catch (unreadError) {
              console.log(`Could not mark chat as unread for ${contact.name}:`, unreadError.message);
            }
          }, 500);
        }
        
        // Store message ID for potential deletion
        messageIds.push({
          contactId: contactId,
          contactName: contact.name,
          whatsappMessageId: sentMessage.id._serialized,
          chatId: contact.number,
          timestamp: sentMessage.timestamp
        });
        
        return { 
          contactId: contactId.toString(), 
          name: contact.name,
          success: true 
        };
      } catch (error) {
        console.error(`Error sending image to ${contact.name}:`, error);
        return { 
          contactId: contactId.toString(), 
          name: contact.name,
          success: false, 
          error: error.message 
        };
      }
    });

    const successCount = results.filter(r => r.success).length;

    // Save to message history
    await WhatsappMessage.create({
      groupId: group._id,
      groupName: group.name,
      message: caption ? `📷 Image: ${caption}` : '📷 Image',
      messageIds
    });

    res.json({ 
      success: true,
      message: `Image sent to ${successCount} of ${group.contactIds.length} contact(s)`,
      successCount,
      totalContacts: group.contactIds.length,
      results
    });
  } catch (error) {
    console.error('Error sending image to group:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
