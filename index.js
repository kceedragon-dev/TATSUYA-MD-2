
/**
 * TATSUYA — ROYAL INTELLIGENCE
 * WhatsApp bot main entry point.
 */
process.env.PUPPETEER_SKIP_DOWNLOAD = 'true';
process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = 'true';
process.env.PUPPETEER_CACHE_DIR =
  process.env.PUPPETEER_CACHE_DIR || '/tmp/puppeteer_cache_disabled';

const { initializeTempSystem } = require('./utils/tempManager');
const { startCleanup } = require('./utils/cleanup');

initializeTempSystem();
startCleanup();

const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

const forbiddenPatternsConsole = [
  'closing session',
  'closing open session',
  'sessionentry',
  'prekey bundle',
  'pendingprekey',
  '_chains',
  'registrationid',
  'currentratchet',
  'chainkey',
  'ratchet',
  'signal protocol',
  'ephemeralkeypair',
  'indexinfo',
  'basekey'
];

console.log = (...args) => {
  const message = args
    .map(a =>
      typeof a === 'string'
        ? a
        : typeof a === 'object'
          ? JSON.stringify(a)
          : String(a)
    )
    .join(' ')
    .toLowerCase();

  if (!forbiddenPatternsConsole.some(pattern => message.includes(pattern))) {
    originalConsoleLog.apply(console, args);
  }
};

console.error = (...args) => {
  const message = args
    .map(a =>
      typeof a === 'string'
        ? a
        : typeof a === 'object'
          ? JSON.stringify(a)
          : String(a)
    )
    .join(' ')
    .toLowerCase();

  if (!forbiddenPatternsConsole.some(pattern => message.includes(pattern))) {
    originalConsoleError.apply(console, args);
  }
};

console.warn = (...args) => {
  const message = args
    .map(a =>
      typeof a === 'string'
        ? a
        : typeof a === 'object'
          ? JSON.stringify(a)
          : String(a)
    )
    .join(' ')
    .toLowerCase();

  if (!forbiddenPatternsConsole.some(pattern => message.includes(pattern))) {
    originalConsoleWarn.apply(console, args);
  }
};

// Load libraries after console filtering is configured.
const pino = require('pino');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const config = require('./config');
const handler = require('./handler');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const os = require('os');

// Remove Puppeteer cache if a dependency created one.
function cleanupPuppeteerCache() {
  try {
    const home = os.homedir();
    const cacheDir = path.join(home, '.cache', 'puppeteer');

    if (fs.existsSync(cacheDir)) {
      console.log('🧹 Removing Puppeteer cache at:', cacheDir);
      fs.rmSync(cacheDir, { recursive: true, force: true });
      console.log('✅ Puppeteer cache removed');
    }
  } catch (err) {
    console.error(
      '⚠️ Failed to cleanup Puppeteer cache:',
      err.message || err
    );
  }
}

// In-memory message store with per-chat limits.
const store = {
  messages: new Map(),
  maxPerChat: 20,

  bind: ev => {
    ev.on('messages.upsert', ({ messages }) => {
      for (const msg of messages) {
        if (!msg.key?.id) continue;

        const jid = msg.key.remoteJid;
        if (!jid) continue;

        if (!store.messages.has(jid)) {
          store.messages.set(jid, new Map());
        }

        const chatMsgs = store.messages.get(jid);
        chatMsgs.set(msg.key.id, msg);

        if (chatMsgs.size > store.maxPerChat) {
          const oldestKey = chatMsgs.keys().next().value;
          chatMsgs.delete(oldestKey);
        }
      }
    });
  },

  loadMessage: async (jid, id) => {
    return store.messages.get(jid)?.get(id) || null;
  }
};

// Keep message deduplication memory bounded.
const processedMessages = new Set();
const MAX_PROCESSED_MESSAGES = 5000;

// Prevent duplicate reconnect timers.
let reconnectTimer = null;

function scheduleReconnect(delay = 3000) {
  if (reconnectTimer) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;

    startBot().catch(err => {
      console.error(
        'Tatsuya reconnect failed:',
        err.message || err
      );

      scheduleReconnect(5000);
    });
  }, delay);
}

// Quiet Baileys logs and redact sensitive session fields.
const createSuppressedLogger = (level = 'silent') => {
  try {
    return pino({
      level,
      redact: [
        'registrationId',
        'ephemeralKeyPair',
        'rootKey',
        'chainKey',
        'baseKey'
      ]
    });
  } catch (err) {
    return pino({ level: 'silent' });
  }
};

// Main WhatsApp connection.
async function startBot() {
  const sessionFolder = `./${config.sessionName}`;
  const sessionFile = path.join(sessionFolder, 'creds.json');

  // Import a KnightBot session only if local credentials do not exist.
  if (
    config.sessionID &&
    config.sessionID.startsWith('KnightBot!') &&
    !fs.existsSync(sessionFile)
  ) {
    try {
      const [header, b64data] = config.sessionID.split('!');

      if (header !== 'KnightBot' || !b64data) {
        throw new Error(
          "Invalid session format. Expected 'KnightBot!.....'"
        );
      }

      const cleanB64 = b64data.replace('...', '');
      const compressedData = Buffer.from(cleanB64, 'base64');
      const decompressedData = zlib.gunzipSync(compressedData);

      if (!fs.existsSync(sessionFolder)) {
        fs.mkdirSync(sessionFolder, { recursive: true });
      }

      fs.writeFileSync(sessionFile, decompressedData, 'utf8');

      console.log(
        '📡 Session: Retrieved from KnightBot session'
      );
    } catch (err) {
      console.error(
        '📡 Session: Error processing session:',
        err.message
      );
    }
  }

  const { state, saveCreds } =
    await useMultiFileAuthState(sessionFolder);

  const { version } = await fetchLatestBaileysVersion();
  const suppressedLogger = createSuppressedLogger('silent');

  const sock = makeWASocket({
    version,
    logger: suppressedLogger,
    printQRInTerminal: false,
    browser: ['Chrome', 'Windows', '10.0'],
    auth: state,
    syncFullHistory: false,
    downloadHistory: false,
    markOnlineOnConnect: false,
    getMessage: async () => undefined
  });

  // Keep the message store connected to this socket.
  store.bind(sock.ev);

  // Handle connection changes.
  sock.ev.on('connection.update', async update => {
    const { connection, lastDisconnect } = update;

    if (connection === 'close') {
      const statusCode =
        lastDisconnect?.error?.output?.statusCode;

      const errorMessage =
        lastDisconnect?.error?.message || 'Unknown error';

      const shouldReconnect =
        statusCode !== DisconnectReason.loggedOut;

      if (
        statusCode === 515 ||
        statusCode === 503 ||
        statusCode === 408
      ) {
        console.log(
          `⚠️ Connection closed (${statusCode}). Reconnecting...`
        );
      } else {
        console.log(
          'Connection closed due to:',
          errorMessage,
          '\nReconnecting:',
          shouldReconnect
        );
      }

      if (shouldReconnect) {
        scheduleReconnect(
          statusCode === 515 ||
          statusCode === 503 ||
          statusCode === 408
            ? 3000
            : 5000
        );
      } else {
        console.log(
          '🔒 WhatsApp logged out. Re-link the device to reconnect.'
        );
      }
    } else if (connection === 'open') {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      console.log('\n✅ Tatsuya connected successfully!');
      console.log(`📱 Bot Number: ${sock.user.id.split(':')[0]}`);
      console.log(`🤖 Bot Name: ${config.botName}`);
      console.log(`⚡ Prefix: ${config.prefix}`);

      const ownerNames = Array.isArray(config.ownerName)
        ? config.ownerName.join(',')
        : config.ownerName;

      console.log(`👑 Owner: ${ownerNames}\n`);
      console.log('Bot is ready to receive messages!\n');

      if (config.autoBio) {
        try {
          await sock.updateProfileStatus(
            `${config.botName} | Active 24/7`
          );
        } catch (err) {
          console.error(
            'Could not update profile status:',
            err.message || err
          );
        }
      }

      // Initialize anti-call feature.
      handler.initializeAntiCall(sock);

      // Remove message histories for chats inactive for over one day.
      const now = Date.now();

      for (const [jid, chatMsgs] of store.messages.entries()) {
        const timestamps = Array.from(chatMsgs.values()).map(
          msg => Number(msg.messageTimestamp || 0) * 1000
        );

        if (
          timestamps.length > 0 &&
          now - Math.max(...timestamps) > 24 * 60 * 60 * 1000
        ) {
          store.messages.delete(jid);
        }
      }

      console.log(
        `🧹 Store cleaned. Active chats: ${store.messages.size}`
      );
    }
  });

  // Save authentication credentials whenever they change.
  sock.ev.on('creds.update', saveCreds);

  // ------------------------------------------------------
  // TATSUYA INTERNATIONAL PHONE-NUMBER PAIRING
  // ------------------------------------------------------
  // Set PAIRING_NUMBER in Railway Variables.
  // Include the country calling code. Digits only is preferred.
  // Example format: 2348012345678 (Nigeria)
  // This setting also supports numbers from other countries.
  // ------------------------------------------------------

  const pairingNumberRaw =
    process.env.PAIRING_NUMBER ||
    config.phoneNumber ||
    config.pairingNumber;

  if (!state.creds.registered) {
    if (!pairingNumberRaw) {
      console.log(
        '🔐 Pairing required: set PAIRING_NUMBER in Railway Variables.'
      );
    } else {
      // Accept formats such as +44 7700 900123 or 1-202-555-0123.
      // Non-digit characters are removed before requesting the code.
      const pairingNumber = String(pairingNumberRaw).replace(/\D/g, '');

      if (!pairingNumber) {
        console.error(
          '❌ Invalid PAIRING_NUMBER. Include the country calling code.'
        );
      } else {
        setTimeout(async () => {
          try {
            // Do not request a code if the session has already registered.
            if (state.creds.registered) return;

            const pairingCode =
              await sock.requestPairingCode(pairingNumber);

            console.log('\n================================');
            console.log('  TATSUYA PAIRING CODE');
            console.log('================================');
            console.log(`  CODE: ${pairingCode}`);
            console.log('================================');
            console.log(
              'WhatsApp → Linked Devices → Link a device'
            );
            console.log(
              'Choose "Link with phone number instead".\n'
            );
          } catch (err) {
            console.error(
              '❌ Could not generate pairing code:',
              err.message || err
            );
          }
        }, 1500);
      }
    }
  }

  // Ignore broadcast, status and newsletter messages.
  const isSystemJid = jid => {
    if (!jid) return true;

    return (
      jid.includes('@broadcast') ||
      jid.includes('status.broadcast') ||
      jid.includes('@newsletter') ||
      jid.includes('@newsletter.')
    );
  };

  // Process new incoming messages.
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    // Skip historical messages.
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message || !msg.key?.id) continue;

      const from = msg.key.remoteJid;
      if (!from || isSystemJid(from)) continue;

      // Avoid processing the same message twice.
      const msgId = msg.key.id;
      const dedupeKey = `${from}:${msgId}`;

      if (processedMessages.has(dedupeKey)) continue;

      // Ignore messages older than five minutes.
      const MESSAGE_AGE_LIMIT = 5 * 60 * 1000;
      let messageAge = 0;

      if (msg.messageTimestamp) {
        messageAge =
          Date.now() - Number(msg.messageTimestamp) * 1000;

        if (messageAge > MESSAGE_AGE_LIMIT) continue;
      }

      processedMessages.add(dedupeKey);

      if (processedMessages.size > MAX_PROCESSED_MESSAGES) {
        const oldestKey = processedMessages.values().next().value;

        if (oldestKey !== undefined) {
          processedMessages.delete(oldestKey);
        }
      }

      // Store this message before command processing.
      if (!store.messages.has(from)) {
        store.messages.set(from, new Map());
      }

      const chatMsgs = store.messages.get(from);
      chatMsgs.set(msg.key.id, msg);

      // Keep only the most recent messages per chat.
      if (chatMsgs.size > store.maxPerChat) {
        const sortedIds = Array.from(chatMsgs.entries())
          .sort(
            (a, b) =>
              Number(a[1].messageTimestamp || 0) -
              Number(b[1].messageTimestamp || 0)
          )
          .map(([id]) => id);

        const excess = sortedIds.length - store.maxPerChat;

        for (let i = 0; i < excess; i++) {
          chatMsgs.delete(sortedIds[i]);
        }
      }

      // Process commands without blocking other incoming messages.
      Promise.resolve(handler.handleMessage(sock, msg)).catch(err => {
        if (
          !err.message?.includes('rate-overlimit') &&
          !err.message?.includes('not-authorized')
        ) {
          console.error(
            'Error handling message:',
            err.message || err
          );
        }
      });

      // Run read receipts and anti-link checks in the background.
      setImmediate(async () => {
        if (config.autoRead && from.endsWith('@g.us')) {
          try {
            await sock.readMessages([msg.key]);
          } catch (err) {
            // Ignore read-receipt errors.
          }
        }

        if (from.endsWith('@g.us')) {
          try {
            const groupMetadata = await handler.getGroupMetadata(
              sock,
              from
            );

            if (groupMetadata) {
              await handler.handleAntilink(
                sock,
                msg,
                groupMetadata
              );
            }
          } catch (err) {
            // Ignore group metadata and anti-link errors.
          }
        }
      });
    }
  });

  // Silently handle message receipt updates.
  sock.ev.on('message-receipt.update', () => {});

  // Silently handle message updates.
  sock.ev.on('messages.update', () => {});

  // Handle group join and leave events.
  sock.ev.on('group-participants.update', async update => {
    try {
      await handler.handleGroupUpdate(sock, update);
    } catch (err) {
      console.error(
        'Group participant update failed:',
        err.message || err
      );
    }
  });

  // Handle socket errors.
  sock.ev.on('error', error => {
    const statusCode = error?.output?.statusCode;

    if (
      statusCode === 515 ||
      statusCode === 503 ||
      statusCode === 408
    ) {
      return;
    }

    console.error('Socket error:', error.message || error);
  });

  return sock;
}

// Start TATSUYA.
console.log('🚀 Starting TATSUYA — ROYAL INTELLIGENCE...\n');
console.log(`📦 Bot Name: ${config.botName}`);
console.log(`⚡ Prefix: ${config.prefix}`);

const ownerNames = Array.isArray(config.ownerName)
  ? config.ownerName.join(',')
  : config.ownerName;

console.log(`👑 Owner: ${ownerNames}\n`);

// Clean up Puppeteer cache to help avoid disk-space issues.
cleanupPuppeteerCache();

startBot().catch(err => {
  console.error('Error starting Tatsuya:', err);
  process.exit(1);
});

// Handle process-level exceptions.
process.on('uncaughtException', err => {
  if (
    err.code === 'ENOSPC' ||
    err.errno === -28 ||
    err.message?.includes('no space left on device')
  ) {
    console.error(
      '⚠️ No disk space available. Attempting cleanup...'
    );

    const { cleanupOldFiles } = require('./utils/cleanup');
    cleanupOldFiles();

    console.warn(
      '⚠️ Cleanup completed. Free more disk space if the problem continues.'
    );

    return;
  }

  console.error('Uncaught Exception:', err);
});

// Handle rejected promises.
process.on('unhandledRejection', err => {
  if (
    err?.code === 'ENOSPC' ||
    err?.errno === -28 ||
    err?.message?.includes('no space left on device')
  ) {
    console.warn(
      '⚠️ No disk space available. Attempting cleanup...'
    );

    const { cleanupOldFiles } = require('./utils/cleanup');
    cleanupOldFiles();

    return;
  }

  if (err?.message?.includes('rate-overlimit')) {
    console.warn(
      '⚠️ Rate limit reached. Please slow down your requests.'
    );

    return;
  }

  console.error('Unhandled Rejection:', err);
});

// Export the store for commands that need it.
module.exports = { store };
