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

/**
 * Chrome leaves "Singleton" lock files in its profile when it is killed instead of closed; the next start then
 * refuses to use the profile. They are removed before connecting again (nothing else uses the profile then).
 */
function removeStaleLocks(authPath) {
  try {
    const folder = path.join(authPath, SESSION_FOLDER);
    for (const name of fs.readdirSync(folder)) {
      if (/^Singleton(Lock|Cookie|Socket)$/.test(name)) fs.rmSync(path.join(folder, name), { force: true, recursive: true });
    }
  } catch {
    // no session folder yet
  }
}

/**
 * The hour (0 to 23, server time, UTC on the droplet) at which the browser of WhatsApp is closed and started again every
 * night, so that a page that has been open for days cannot slowly use up the memory of the server. WHATSAPP_RESTART_HOUR
 * sets it (default 23); "off" switches the restart off. Returns null when it is off.
 */
function restartHour(env = process.env) {
  const text = String(env.WHATSAPP_RESTART_HOUR === undefined ? '23' : env.WHATSAPP_RESTART_HOUR).trim().toLowerCase();
  if (text === 'off' || text === 'false' || env.NODE_ENV === 'test') return null;
  const hour = Number(text);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 23;
}

/** The next time it is that hour (always in the future). */
function nextRestartAt(hour, now = new Date()) {
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next;
}

module.exports = { sessionExists, autostartEnabled, shouldReconnect, removeStaleLocks, restartHour, nextRestartAt, SESSION_FOLDER };
