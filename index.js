/**
 * Main Entry Point for Stripchat Monitor Bot
 */
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const { Telegraf } = require('telegraf');
const fs = require('fs-extra');
const path = require('path');
const config = require('./config/config');
const fileServer = require('./fileServer');
fileServer.startServer();
// Initialize the bot with local API server
const bot = new Telegraf(config.BOT_TOKEN, {
  telegram: {
    apiRoot: 'http://localhost:8081', // Local API server address
    timeoutMs: 120000 // 2 minute timeout for larger uploads
  }
});

// Import models
const monitoredUsersModel = require('./models/monitoredUsers');
const premiumUsersModel = require('./models/premiumUsers');
const autoRecordConfigModel = require('./models/autoRecordConfig');

// Import handlers
const commandHandler = require('./handlers/commandHandler');
const messageHandler = require('./handlers/messageHandler');

// Import services
const monitorService = require('./services/monitorService');
const memoryService = require('./services/memoryService');
const browserService = require('./services/browserService');

// Main startup function
async function startBot() {
  try {
    console.log("🚀 Starting Stripchat Monitor Bot...");
    
    // Ensure data directory exists
    const dataDir = path.join(__dirname, 'data');
    await fs.ensureDir(dataDir);
    console.log('📁 Data directory is ready');

    // First, load all data models
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

    // Initialize the bot
    const bot = new Telegraf(config.BOT_TOKEN);
    
    // Register command handlers
    commandHandler.registerCommands(bot);
    
    // Register message handler for non-command messages
    messageHandler.registerHandler(bot);
    
    // Error handling for all bot commands
    bot.catch((err, ctx) => {
      console.error(`Error handling update ${ctx.update.update_id}:`, err);
      
      // Try to notify the user
      try {
        ctx.reply('⚠️ An error occurred while processing your request. Please try again with a shorter duration or try later.')
          .catch(e => console.error('Error sending error notification:', e));
      } catch (notifyError) {
        console.error('Error while trying to notify user about error:', notifyError);
      }
    });
    
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
        { command: 'premium', description: 'View premium info or activate a key' },
        { command: 'autorecord', description: 'Configure automatic goal recording (premium)' },
        { command: 'start', description: 'Show welcome message and command list' }
      ]);
      
      // Start monitoring and cleaning routines
      monitorService.startMonitoring(bot);
      memoryService.startCleanupRoutines();
      
      console.log('✅ Bot startup complete');
    } catch (err) {
      console.error('Error during startup:', err);
    }
    
    // Graceful shutdown handlers
    process.once('SIGINT', () => {
      console.log('SIGINT received. Shutting down gracefully...');
      memoryService.stopCleanupRoutines();
      monitorService.stopMonitoring();
      browserService.closeBrowser();
      bot.stop('SIGINT');
    });
    
    process.once('SIGTERM', () => {
      console.log('SIGTERM received. Shutting down gracefully...');
      memoryService.stopCleanupRoutines();
      monitorService.stopMonitoring();
      browserService.closeBrowser();
      bot.stop('SIGTERM');
    });
    
  } catch (err) {
    console.error('❌ Failed to start bot:', err);
    process.exit(1);
  }
}

// Start the bot
startBot().catch(err => {
  console.error('Fatal error starting bot:', err);
  process.exit(1);
  
});