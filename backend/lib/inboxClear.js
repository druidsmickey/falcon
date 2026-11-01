const WhatsappInbox = require('../models/whatsappInbox');
const WhatsappOdds = require('../models/whatsappOdds');

const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000;

/**
 * Empties the WhatsApp inbox (bets waiting, confirmed and dismissed) and the odds lists that set the race. Done when a
 * meeting is deleted, since the bets belong to it. With olderThan only what is older than that is removed.
 */
async function clearInbox(olderThan = null) {
  const filter = olderThan ? { createdAt: { $lt: olderThan } } : {};
  const [inbox, odds] = await Promise.all([WhatsappInbox.deleteMany(filter), WhatsappOdds.deleteMany(filter)]);
  return { inbox: inbox.deletedCount, odds: odds.deletedCount };
}

/** Anything in the inbox that is more than 6 days old goes, like the meetings. */
const clearOldInbox = () => clearInbox(new Date(Date.now() - SIX_DAYS_MS));

module.exports = { clearInbox, clearOldInbox };
