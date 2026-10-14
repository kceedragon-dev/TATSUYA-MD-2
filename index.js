/**
 * TATSUYA — ROYAL INTELLIGENCE
 * WhatsApp bot main entry point.
 */

process.env.PUPPETEER_SKIP_DOWNLOAD = 'true';
process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = 'true';

const fs = require('fs');
const path = require('path');
const pino = require('pino');

const config = require('./config');
const handler = require('./handler');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

// --------------------------------------------------
// CONFIGURATION
// --------------------------------------------------

const SESSION_NAME = config.sessionName || 'session';

const SESSION_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, SESSION_NAME)
  : path.join(__dirname, SESSION_NAME);

const PAIRING_NUMBER =
  process.env.PAIRING_NUMBER ||
  config.phoneNumber ||
  config.pairingNumber ||
  '';

const processedMessages = new Set();
const MAX_PROCESSED_MESSAGES = 5000;

let reconnectTimer = null;
let starting = false;
let currentSocket = null;

// --------------------------------------------------
// LOGGER
// --------------------------------------------------

const logger = pino({
  level: process.env.LOG_LEVEL || 'warn',
  redact: {
    paths: [
      'registrationId',
      'signedIdentityKey',
      'signedPreKey',
      'private',
      'ephemeralKeyPair',
      'rootKey',
      'chainKey',
      'baseKey',
      'creds'
    ],
    censor: '[REDACTED]'
  }
});

// --------------------------------------------------
// MESSAGE STORE
// --------------------------------------------------

const store = {
  messages: new Map(),
  maxPerChat: 20,

  bind: ev => {
    ev.on('messages.upsert', ({ messages }) => {
      for (const msg of messages || []) {
        if (!msg?.key?.id || !msg.key.remoteJid) continue;

        const jid = msg.key.remoteJid;

        if (!store.messages.has(jid)) {
          store.messages.set(jid, new Map());
        }

        const chatMessages = store.messages.get(jid);
        chatMessages.set(msg.key.id, msg);

        while (chatMessages.size > store.maxPerChat) {
          const oldestKey = chatMessages.keys().next().value;
          chatMessages.delete(oldestKey);
        }
      }
    });
  },

  loadMessage: async (jid, id) => {
    return store.messages.get(jid)?.get(id) || null;
  }
};

// --------------------------------------------------
// RECONNECTION
// --------------------------------------------------

function scheduleReconnect(delay = 5000) {
  if (reconnectTimer) return;

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;

    try {
      await startBot();
    } catch (err) {
      console.error(
        'TATSUYA reconnect failed:',
        err?.message || err
      );

      scheduleReconnect(10000);
    }
  }, delay);
}

// --------------------------------------------------
// INTERNATIONAL PHONE NUMBER
// --------------------------------------------------

function normalizePhoneNumber(value) {
  return String(value || '').replace(/\D/g, '');
}

// Examples:
// Kenya:     254782902024
// Nigeria:   2348012345678
// USA:       12025550123
// UK:        447700900123
//
// Always include the country calling code.
// Do not include the leading national trunk zero.

function validatePhoneNumber(number) {
  return /^\d{8,15}$/.test(number);
}

// --------------------------------------------------
// START WHATSAPP BOT
// --------------------------------------------------

async function startBot() {
  if (starting) {
    console.log('A TATSUYA startup is already in progress.');
    return;
  }

  starting = true;

  try {
    console.log('Preparing TATSUYA session...');
    console.log('Session directory:', SESSION_DIR);

    fs.mkdirSync(SESSION_DIR, { recursive: true });

    const { state, saveCreds } =
      await useMultiFileAuthState(SESSION_DIR);

    const { version } = await fetchLatestBaileysVersion();

    console.log('Baileys version:', version.join('.'));

    const sock = makeWASocket({
      version,
      logger,
      auth: state,
      browser: ['TATSUYA', 'Chrome', '1.0.0'],
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      getMessage: async key => {
        return store.loadMessage(
          key.remoteJid,
          key.id
        );
      }
    });

    currentSocket = sock;

    store.bind(sock.ev);

    // Save authentication credentials whenever they change.
    sock.ev.on('creds.update', saveCreds);

    // --------------------------------------------------
    // CONNECTION STATUS
    // --------------------------------------------------

    sock.ev.on('connection.update', async update => {
      const { connection, lastDisconnect } = update;

      if (connection === 'connecting') {
        console.log('Connecting to WhatsApp...');
      }

      if (connection === 'open') {
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }

        console.log('');
        console.log('======================================');
        console.log(' TATSUYA — ROYAL INTELLIGENCE');
        console.log(' WhatsApp connected successfully');
        console.log('======================================');

        console.log(
          'Bot number:',
          sock.user?.id?.split(':')[0] || 'Unknown'
        );

        console.log('Bot name:', config.botName || 'TATSUYA');
        console.log('Prefix:', config.prefix || '!');
        console.log(
          'Owner:',
          Array.isArray(config.ownerName)
            ? config.ownerName.join(', ')
            : config.ownerName || 'Not configured'
        );

        console.log('TATSUYA is ready.');

        if (config.autoBio) {
          try {
            await sock.updateProfileStatus(
              `${config.botName || 'TATSUYA'} | Active 24/7`
            );
          } catch (err) {
            console.error(
              'Profile status update failed:',
              err?.message || err
            );
          }
        }

        try {
          if (typeof handler.initializeAntiCall === 'function') {
            handler.initializeAntiCall(sock);
          }
        } catch (err) {
          console.error(
            'Anti-call initialization failed:',
            err?.message || err
          );
        }
      }

      if (connection === 'close') {
        const statusCode =
          lastDisconnect?.error?.output?.statusCode;

        const errorMessage =
          lastDisconnect?.error?.message || 'Unknown reason';

        console.error(
          'WhatsApp connection closed.',
          'Status:',
          statusCode ?? 'unknown',
          'Reason:',
          errorMessage
        );

        currentSocket = null;

        if (statusCode === DisconnectReason.loggedOut) {
          console.error(
            'WhatsApp logged out. Remove the old session only if you intend to relink.'
          );
          return;
        }

        scheduleReconnect(
          statusCode === 515 ||
          statusCode === 503 ||
          statusCode === 408
            ? 3000
            : 7000
        );
      }
    });

    // --------------------------------------------------
    // PAIRING CODE
    // --------------------------------------------------

    if (!state.creds.registered) {
      const phoneNumber = normalizePhoneNumber(PAIRING_NUMBER);

      if (!phoneNumber) {
        console.log(
          'Pairing required. Set PAIRING_NUMBER in Railway Variables.'
        );
      } else if (!validatePhoneNumber(phoneNumber)) {
        console.error(
          'PAIRING_NUMBER is invalid. Use 8–15 digits including the country calling code.'
        );
      } else {
        console.log(
          'Pairing is required for the configured international number.'
        );

        // Give the socket time to initialize before requesting a code.
        setTimeout(async () => {
          try {
            if (state.creds.registered) {
              console.log(
                'Pairing skipped because the session is already registered.'
              );
              return;
            }

            if (currentSocket !== sock) {
              console.log(
                'Pairing skipped because this socket is no longer active.'
              );
              return;
            }

            console.log('Requesting WhatsApp pairing code...');

            const code = await sock.requestPairingCode(phoneNumber);

            console.log('');
            console.log('======================================');
            console.log(' TATSUYA PAIRING CODE');
            console.log('======================================');
            console.log('CODE:', code);
            console.log('======================================');
            console.log(
              'On WhatsApp, open Linked Devices.'
            );
            console.log(
              'Select Link a device, then Link with phone number instead.'
            );
            console.log('======================================');
          } catch (err) {
            console.error(
              'PAIRING CODE REQUEST FAILED:',
              err?.message || err
            );

            if (err?.output?.statusCode) {
              console.error(
                'Pairing status code:',
                err.output.statusCode
              );
            }
          }
        }, 5000);
      }
    }

    // --------------------------------------------------
    // SYSTEM MESSAGE FILTER
    // --------------------------------------------------

    function isSystemJid(jid) {
      if (!jid) return true;

      return (
        jid.includes('@broadcast') ||
        jid.includes('@newsletter') ||
        jid.includes('status.broadcast')
      );
    }

    // --------------------------------------------------
    // INCOMING MESSAGES
    // --------------------------------------------------

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages || []) {
        if (!msg?.message || !msg?.key?.id) continue;

        const from = msg.key.remoteJid;

        if (!from || isSystemJid(from)) continue;

        const dedupeKey = `${from}:${msg.key.id}`;

        if (processedMessages.has(dedupeKey)) continue;

        // Ignore messages older than five minutes.
        if (msg.messageTimestamp) {
          const age =
            Date.now() -
            Number(msg.messageTimestamp) * 1000;

          if (age > 5 * 60 * 1000) continue;
        }

        processedMessages.add(dedupeKey);

        if (processedMessages.size > MAX_PROCESSED_MESSAGES) {
          const oldestKey =
            processedMessages.values().next().value;

          if (oldestKey !== undefined) {
            processedMessages.delete(oldestKey);
          }
        }

        // Store messages for commands that need quoted messages.
        if (!store.messages.has(from)) {
          store.messages.set(from, new Map());
        }

        const chatMessages = store.messages.get(from);
        chatMessages.set(msg.key.id, msg);

        while (chatMessages.size > store.maxPerChat) {
          const oldestKey = chatMessages.keys().next().value;
          chatMessages.delete(oldestKey);
        }

        // Run the existing command handler.
        Promise.resolve()
          .then(() => handler.handleMessage(sock, msg))
          .catch(err => {
            console.error(
              'Message handler failed:',
              err?.message || err
            );
          });

        // Group anti-link checks.
        if (from.endsWith('@g.us')) {
          setImmediate(async () => {
            try {
              if (config.autoRead) {
                await sock.readMessages([msg.key]);
              }

              if (
                typeof handler.getGroupMetadata === 'function' &&
                typeof handler.handleAntilink === 'function'
              ) {
                const metadata =
                  await handler.getGroupMetadata(sock, from);

                if (metadata) {
                  await handler.handleAntilink(
                    sock,
                    msg,
                    metadata
                  );
                }
              }
            } catch (err) {
              console.error(
                'Group protection check failed:',
                err?.message || err
              );
            }
          });
        }
      }
    });

    // --------------------------------------------------
    // GROUP EVENTS
    // --------------------------------------------------

    sock.ev.on('group-participants.update', async update => {
      try {
        if (typeof handler.handleGroupUpdate === 'function') {
          await handler.handleGroupUpdate(sock, update);
        }
      } catch (err) {
        console.error(
          'Group update handler failed:',
          err?.message || err
        );
      }
    });

    // --------------------------------------------------
    // SOCKET ERRORS
    // --------------------------------------------------

    sock.ev.on('error', err => {
      console.error(
        'WhatsApp socket error:',
        err?.message || err
      );
    });

    return sock;
  } finally {
    starting = false;
  }
}

// --------------------------------------------------
// START APPLICATION
// --------------------------------------------------

console.log('');
console.log('Starting TATSUYA — ROYAL INTELLIGENCE...');
console.log('Bot name:', config.botName || 'TATSUYA');
console.log('Prefix:', config.prefix || '!');

startBot().catch(err => {
  console.error(
    'TATSUYA startup failed:',
    err?.stack || err?.message || err
  );

  process.exitCode = 1;
});

// --------------------------------------------------
// PROCESS ERRORS
// --------------------------------------------------

process.on('uncaughtException', err => {
  console.error(
    'Uncaught exception:',
    err?.stack || err?.message || err
  );
});

process.on('unhandledRejection', err => {
  console.error(
    'Unhandled promise rejection:',
    err?.stack || err?.message || err
  );
});

// Export the store for commands that need it.
module.exports = { store };
