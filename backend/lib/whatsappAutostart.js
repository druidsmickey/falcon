// When WhatsApp should connect by itself. The server restarts at every deploy and reboot, and the inbox only
// works while WhatsApp is connected, so a saved session is reconnected without anyone pressing Initialize.
const fs = require('fs');
const path = require('path');

/** The folder LocalAuth keeps the session of this app in (see routes/whatsapp.js). */
const SESSION_FOLDER = 'session-itb-whatsapp-client';

/** True when a logged-in session is saved on this server, so that connecting needs no QR code. */
function sessionExists(authPath) {
  try {
    const folder = path.join(authPath, SESSION_FOLDER);
    return fs.existsSync(folder) && fs.readdirSync(folder).length > 0;
  } catch {
    return false;
  }
}

/** Switched off with WHATSAPP_AUTOSTART=false (for example on a computer used for development). */
function autostartEnabled(env = process.env) {
  return String(env.WHATSAPP_AUTOSTART || '').toLowerCase() !== 'false' && env.NODE_ENV !== 'test';
}

/**
 * Whether to reconnect after the connection was lost. Not when the phone logged this device out (the saved
 * session is no good then and a new QR code is needed).
 */
function shouldReconnect(reason) {
  return !/LOGOUT/i.test(String(reason || ''));
}

module.exports = { sessionExists, autostartEnabled, shouldReconnect, SESSION_FOLDER };
