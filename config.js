/**
 * TATSUYA — ROYAL INTELLIGENCE
 * Global configuration
 */

module.exports = {
  // Owner configuration
  ownerNumber: [
    '254782902024'
  ],
  ownerName: [
    'PROSKI'
  ],

  // Bot configuration
  botName: 'TATSUYA',
  botTitle: 'ROYAL INTELLIGENCE',
  prefix: '!',
  sessionName: 'session',
  sessionID: process.env.SESSION_ID || '',

  // International pairing number
  phoneNumber: process.env.PAIRING_NUMBER || '',

  // Optional links
  newsletterJid: '',
  updateZipUrl: '',

  // Sticker configuration
  packname: 'TATSUYA — ROYAL INTELLIGENCE',
  author: 'PROSKI',

  // Bot behavior
  selfMode: false,
  autoRead: false,
  autoTyping: false,
  autoBio: false,
  autoSticker: false,
  autoReact: false,
  autoReactMode: 'bot',
  autoDownload: false,

  // Group defaults
  defaultGroupSettings: {
    antilink: false,
    antilinkAction: 'delete',

    antitag: false,
    antitagAction: 'delete',

    antiall: false,
    antiviewonce: false,

    antibot: false,
    antibotAction: 'warn',

    anticall: false,

    antigroupmention: false,
    antigroupmentionAction: 'delete',

    antigroupstatus: false,
    antigroupstatusAction: 'delete',

    antisticker: false,
    antistickerAction: 'delete',

    antibadword: false,
    antibadwordAction: 'delete',

    welcome: false,
    welcomeMessage:
      'Welcome @user to @group!',

    goodbye: false,
    goodbyeMessage:
      'Goodbye @user!',

    antiSpam: false,
    antidelete: false,
    nsfw: false,
    detect: false,
    chatbot: false,
    autosticker: false
  },

  // API keys
  apiKeys: {
    openai: process.env.OPENAI_API_KEY || '',
    deepai: process.env.DEEPAI_API_KEY || '',
    remove_bg: process.env.REMOVE_BG_API_KEY || ''
  },

  // Bot messages
  messages: {
    wait: '⏳ Please wait...',
    success: '✅ Success!',
    error: '❌ An error occurred.',
    ownerOnly: '👑 This command is for the bot owner only!',
    adminOnly: '🛡️ This command requires a group admin.',
    groupOnly: '👥 This command can only be used in groups.',
    privateOnly: '💬 This command can only be used in private chat.',
    botAdminNeeded: '🤖 The bot must be a group admin.',
    invalidCommand: '❓ Invalid command! Type !menu for help.'
  },

  // Timezone and limits
  timezone: 'Africa/Lagos',
  maxWarnings: 3,

  // Social links
  social: {
    github: 'https://github.com/kceedragon-dev',
    instagram: '',
    youtube: ''
  }
};
