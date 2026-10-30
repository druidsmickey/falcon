const express = require('express');
const mongoose = require('mongoose');
const WhatsappContact = require('../models/whatsappContact');
const inbox = require('../lib/whatsappInbox');

const router = express.Router();
const validId = id => mongoose.Types.ObjectId.isValid(id);

// GET: all saved contacts with their nickname and whether they are listened to
router.get('/contacts', async (req, res) => {
  try {
    const contacts = await WhatsappContact.find().sort({ name: 1 });
    res.json({
      contacts: contacts.map(c => ({ id: c._id.toString(), name: c.name, number: c.number, nickname: c.nickname || '', listen: !!c.listen })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH: choose whether to listen to a contact, and the nickname its bets are entered under
router.patch('/contacts/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const contact = await inbox.updateContact(req.params.id, req.body || {});
    if (!contact) return res.status(404).json({ error: 'contact not found' });
    res.json({ id: contact._id.toString(), nickname: contact.nickname || '', listen: !!contact.listen });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// GET: the bets read from messages that wait for confirmation, and the odds list that sets the race
router.get('/', async (req, res) => {
  try {
    res.json(await inbox.listPending());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET / PUT: the AI that gives a second opinion on messages the rules could not read (the key is never sent back)
router.get('/ai', async (req, res) => {
  try {
    res.json(await inbox.getAiSettings());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/ai', async (req, res) => {
  try {
    res.json(await inbox.saveAiSettings(req.body));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST: try the AI with a sample line
router.post('/ai/test', async (req, res) => {
  try {
    res.json(await inbox.testAi(req.body && req.body.text));
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// DELETE: forget the corrections the AI is shown as examples
router.delete('/ai/examples', async (req, res) => {
  try {
    res.json({ success: true, deleted: await inbox.forgetCorrections() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET: what the server did with the latest messages (to find out why one did not arrive)
router.get('/activity', (req, res) => {
  res.json({ messages: inbox.getActivity(), counters: inbox.getCounters(), trace: inbox.getTrace() });
});

// GET: how many bets wait for approval (shown on the tab)
router.get('/count', async (req, res) => {
  try {
    res.json({ count: await inbox.countPending() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST: sample bets so that the screen can be tried (they save nothing when confirmed)
router.post('/demo', async (req, res) => {
  try {
    res.json({ success: true, added: await inbox.createDemo() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE: remove the sample bets
router.delete('/demo', async (req, res) => {
  try {
    res.json({ success: true, removed: await inbox.clearDemo() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

for (const [action, status] of [['confirm', 'confirmed'], ['dismiss', 'dismissed']]) {
  router.post(`/:id/${action}`, async (req, res) => {
    if (!validId(req.params.id)) return res.status(400).json({ error: 'invalid id' });
    try {
      res.json({ success: true, changed: await inbox.decide(req.params.id, status, action === 'confirm' ? req.body && req.body.saved : undefined) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
}

module.exports = router;
