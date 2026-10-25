// Copies the contacts of the phone into the saved contacts, where each gets a nickname and a "listen" choice.
// Contacts that are already saved keep their nickname and listen choice; only their name follows the phone.
const WhatsappContact = require('../models/whatsappContact');

/**
 * The contacts worth saving from what the WhatsApp client lists: people (not groups) that have a name in the
 * phone's address book, other than the account itself.
 */
function usableContacts(all) {
  const seen = new Set();
  const result = [];
  for (const contact of all || []) {
    const number = contact && contact.id && contact.id._serialized;
    const name = contact && (contact.name || '').trim();
    if (!contact || !contact.isUser || contact.isMe || !name || !number || seen.has(number)) continue;
    seen.add(number);
    result.push({ number, name });
  }
  return result;
}

/**
 * @param {{number: string, name: string}[]} contacts from usableContacts
 * @returns {Promise<{ total: number, added: number, renamed: number }>}
 */
async function syncContacts(contacts) {
  let added = 0;
  let renamed = 0;
  for (const { number, name } of contacts) {
    const existing = await WhatsappContact.findOne({ number });
    if (!existing) {
      await WhatsappContact.create({ number, name });
      added += 1;
    } else if (existing.name !== name) {
      existing.name = name;
      await existing.save();
      renamed += 1;
    }
  }
  return { total: contacts.length, added, renamed };
}

module.exports = { usableContacts, syncContacts };
