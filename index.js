/**
 * Main Entry Point for Enhanced Stripchat Monitor Bot
 */
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const { Telegraf, session } = require('telegraf');
const fs = require('fs-extra');
const path = require('path');
const config = require('./config/config');

// Initialize the bot with local API server
const bot = new Telegraf(config.BOT_TOKEN, {
  telegram: {
    apiRoot: 'http://localhost:8081', // Local API server address
    timeoutMs: 120000 // 2 minute timeout for larger uploads
  }
});

// Enable session for handling conversation state
bot.use(session());

// Import models
const monitoredUsersModel = require('./models/monitoredUsers');
const premiumUsersModel = require('./models/premiumUsers');
const autoRecordConfigModel = require('./models/autoRecordConfig');

// Import admin command handler for checking disabled commands
const adminCommands = require('./handlers/commands/adminCommands');

// Import handlers
const commandHandler = require('./handlers/commandHandler');
const messageHandler = require('./handlers/messageHandler');

// Import services
const notifierService = require('./services/notifierService');
const goalMonitorService = require('./services/goalMonitorService'); 
const memoryService = require('./services/memoryService');
const browserService = require('./services/browserService');

async function startBot() {
  try {
    console.log("🚀 Starting Enhanced Stripchat Monitor Bot...");

    // Ensure data directory exists
    const dataDir = path.join(__dirname, 'data');
    await fs.ensureDir(dataDir);
    console.log('📁 Data directory is ready');

    // Load all data models
    console.log('📚 Loading data models...');
    
    try {
      const users = await monitoredUsersModel.loadMonitoredUsers();
      console.log(`✅ Loaded ${users.length} monitored users`);
    } catch (err) {
      console.error('❌ Error loading monitored users:', err);
    }
    
    try {
      const premium = await premiumUsersModel.loadPremiumUsers();
      console.log(`✅ Loaded ${Object.keys(premium).length} premium users`);
    } catch (err) {
      console.error('❌ Error loading premium users:', err);
    }
    
    try {
      const autoConfig = await autoRecordConfigModel.loadAutoRecordConfig();
      console.log(`✅ Loaded auto-record config for ${Object.keys(autoConfig).length} users`);
    } catch (err) {
      console.error('❌ Error loading auto-record config:', err);
    }
    
    console.log('✅ All data models loaded successfully');

    // Register command handlers
    commandHandler.registerCommands(bot);
    
    // Register message handler for non-command messages
    messageHandler.registerHandler(bot);
    
    // Error handling for all bot commands
    bot.catch((err, ctx) => {
      console.error(`Error handling update ${ctx.update.update_id}:`, err);
      try {
        ctx.reply('⚠️ An error occurred while processing your request. Please try again later.')
          .catch(e => {});
      } catch (notifyError) {
        console.error('Error while trying to notify user about error:', notifyError);
      }
    });

    // 🔥 Start the notifier **before** launching the bot
    console.log("🚀 Starting Notifier Service...");
    await notifierService.startNotifier(bot);  
    console.log("✅ Notifier Service is running!");

    // 🔥 Start the goal monitor service
    console.log("🚀 Starting Goal Monitor Service...");
    await goalMonitorService.startGoalMonitoring(bot);
    console.log("✅ Goal Monitor Service is running!");

    // Start the bot
    await bot.launch();
    console.log("✅ Telegram bot is up and running!");

    try {
      // Set bot commands for the menu
      await bot.telegram.setMyCommands([
        { command: 'add', description: 'Add a new streamer to monitor' },
        { command: 'remove', description: 'Remove a monitored streamer' },
        { command: 'list', description: 'List all monitored streamers' },
        { command: 'record', description: 'Record a live stream' },
        { command: 'info', description: 'Get detailed info about a streamer' },
        { command: 'popular', description: 'View popular live streamers' },
        { command: 'search', description: 'Search streamers by category (Premium)' },
        { command: 'premium', description: 'View premium info or activate a key' },
        { command: 'goalrecord', description: 'Configure automatic goal recording (Premium)' },
        { command: 'extend', description: 'Extend a current recording (Premium)' },
        { command: 'progress', description: 'Check recording progress' },
        { command: 'help', description: 'Show help message and command list' },
        { command: 'start', description: 'Show welcome message and command list' }
      ]);

      // Start cleanup routines
      memoryService.startCleanupRoutines();

      console.log('✅ Bot startup complete');

      // Start continuous monitoring after a short delay
      setTimeout(() => {
        setupContinuousMonitoring(bot);
      }, 5000);

    } catch (err) {
      console.error('Error during startup:', err);
    }

  } catch (err) {
    console.error('❌ Failed to start bot:', err);
    process.exit(1);
  }
}

// Graceful shutdown handlers
process.once('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully...');
  clearInterval(global.monitorRefreshInterval);
  clearInterval(global.dailyRebuildInterval);
  memoryService.stopCleanupRoutines();
  notifierService.stopNotifier();
  goalMonitorService.stopGoalMonitoring();
  browserService.closeBrowser();
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  clearInterval(global.monitorRefreshInterval);
  clearInterval(global.dailyRebuildInterval);
  memoryService.stopCleanupRoutines();
  notifierService.stopNotifier();
  goalMonitorService.stopGoalMonitoring();
  browserService.closeBrowser();
  bot.stop('SIGTERM');
});

// Start the bot
startBot().catch(err => {
  console.error('Fatal error starting bot:', err);
  process.exit(1);
});