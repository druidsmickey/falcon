const mongoose = require('mongoose');

// A bet read from a WhatsApp message, waiting for a person to check and confirm it. Nothing is a bet
// until it is confirmed in the app, which sends it through the normal bet entry.
const whatsappInboxSchema = new mongoose.Schema({
  // messageId + line number: one message can hold several bets, and a message is never read twice
  key: { type: String, required: true, unique: true },
  messageId: { type: String, required: true },
  contactNumber: { type: String, required: true },
  contactName: { type: String, default: '' },
  // what the bet is entered under: the nickname, or the contact name when there is none
  clientName: { type: String, required: true },
  text: { type: String, required: true },
  sentAt: { type: Date, required: true },

  unreadable: { type: Boolean, default: false },
  raceNum: { type: Number, default: null },
  horseNum: { type: Number, default: null },
  mode: { type: String, enum: ['f500', 'odds', null], default: null },
  amountKind: { type: String, enum: ['books', 'stake', '?'], default: '?' },
  amount: { type: Number, default: null },
  books: { type: Number, default: null },
  f500: { type: Number, default: null },
  stake: { type: Number, default: null },
  odds100: { type: Number, default: null },
  unsure: { type: Boolean, default: false },
  issues: { type: [String], default: [] },

  status: { type: String, enum: ['pending', 'confirmed', 'dismissed'], default: 'pending' },
  // the request id the bet is sent with, so confirming twice (or after a lost answer) cannot enter it twice
  clientRequestId: { type: String, required: true },
  decidedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});

whatsappInboxSchema.index({ status: 1, sentAt: 1 });
// messages are removed after a week, like the meetings
whatsappInboxSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

module.exports = mongoose.model('WhatsappInbox', whatsappInboxSchema);
