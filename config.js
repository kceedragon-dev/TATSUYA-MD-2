```js
/**
 * Global Configuration for TATSUYA
 * TATSUYA — ROYAL INTELLIGENCE
 */

module.exports = {
    // Bot Owner Configuration
    ownerNumber: ['254782902024'],
    ownerName: ['PROSKI'],

    // Bot Configuration
    botName: 'TATSUYA',
    botTitle: 'ROYAL INTELLIGENCE',
    prefix: '!',
    sessionName: 'session',
    sessionID: process.env.SESSION_ID || '',

    // Optional integrations
    newsletterJid: '',
    updateZipUrl: '',

    // Sticker Configuration
    packname: 'TATSUYA — ROYAL INTELLIGENCE',

    // Bot Behavior
    selfMode: false,
    autoRead: false,
    autoTyping: false,
    autoBio: false,
    autoSticker: false,
    autoReact: false,
    autoReactMode: 'bot',
    autoDownload: false,

    // Group Settings Defaults
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
            '╭╼━≪• 𝚆𝙴𝙻𝙲𝙾𝙼𝙴 •≫━╾╮\n' +
            '┃ Welcome: @user 👋\n' +
            '┃ Members: #memberCount\n' +
            '┃ Time: time ⏰\n' +
            '╰━━━━━━━━━━━━━━━╯\n\n' +
            '*Welcome to @group!* 🎉\n' +
            'groupDesc\n\n' +
            '> Powered by TATSUYA',

        goodbye: false,
        goodbyeMessage: 'Goodbye @user 👋',

        antiSpam: false,
        antidelete: false,
        nsfw: false,
        detect: false,
        chatbot: false,
        autosticker: false
    },

    // API Keys
    apiKeys: {
        openai: process.env.OPENAI_API_KEY || '',
        deepai: process.env.DEEPAI_API_KEY || '',
        remove_bg: process.env.REMOVE_BG_API_KEY || ''
    },

    // Message Configuration
    messages: {
        wait: '⏳ Please wait...',
        success: '✅ Success!',
        error: '❌ An error occurred!',
        ownerOnly: '👑 This command is only for the bot owner!',
        adminOnly: '🛡️ This command is only for group admins!',
        groupOnly: '👥 This command can only be used in groups!',
        privateOnly: '💬 This command can only be used in private chat!',
        botAdminNeeded: '🤖 The bot needs to be an admin to do that!',
        invalidCommand: '❓ Invalid command! Type !menu for help.'
    },

    // Timezone
    timezone: 'Africa/Nairobi',

    // Limits
    maxWarnings: 3,

    // Social Links
    social: {
        github: 'https://github.com/kceedragon-dev',
        instagram: '',
        youtube: ''
    }
};
