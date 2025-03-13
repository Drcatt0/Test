/**
 * Main Entry Point for Enhanced Stripchat Monitor Bot
 */
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const { Telegraf, session } = require('telegraf');
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
const goalMonitorService = require('./services/goalMonitorService'); // New import
const memoryService = require('./services/memoryService');
const browserService = require('./services/browserService');

// Main startup function
async function startBot() {
  try {
    console.log("🚀 Starting Enhanced Stripchat Monitor Bot...");
    
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

    // Add middleware to check for disabled commands
    bot.use((ctx, next) => {
      if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/')) {
        // Extract command without slash
        const commandText = ctx.message.text.split(' ')[0].substring(1).split('@')[0];
        
        // Check if command is disabled using adminCommands.isCommandDisabled
        if (adminCommands.isCommandDisabled && adminCommands.isCommandDisabled(commandText)) {
          return ctx.reply(`⚠️ The command /${commandText} is currently disabled by the administrator.`);
        }
      }
      return next();
    });

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
          .catch(e => {});
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
      
      // Set limits
      config.FREE_USER_MAX_DURATION = 45; // 45 seconds for free users
      config.PREMIUM_USER_MAX_DURATION = 1200; // 20 minutes for premium users
      config.FREE_USER_COOLDOWN = 3 * 60 * 1000; // 3 minute cooldown
      
      // Start enhanced goal monitoring service
      console.log("🎯 Starting enhanced goal monitoring service...");
      await goalMonitorService.startGoalMonitoring(bot);
      
      // Start notifier service
      console.log("🔔 Starting enhanced notifier service...");
      await notifierService.startNotifier(bot);
      
      // Start cleanup routines
      memoryService.startCleanupRoutines();
      
      // Restart services every few hours to ensure they're running properly
      const servicesRestartInterval = setInterval(() => {
        console.log("🔄 Scheduled services restart for health maintenance");
        notifierService.restartNotifier(bot);
        
        // Restart goal monitoring with small delay
        setTimeout(() => {
          goalMonitorService.stopGoalMonitoring();
          goalMonitorService.startGoalMonitoring(bot);
        }, 30000); // 30 seconds after notifier
      }, 4 * 60 * 60 * 1000); // Every 4 hours
      
      console.log('✅ Bot startup complete');
      
      // Graceful shutdown handlers
      process.once('SIGINT', () => {
        console.log('SIGINT received. Shutting down gracefully...');
        clearInterval(servicesRestartInterval);
        memoryService.stopCleanupRoutines();
        notifierService.stopNotifier();
        goalMonitorService.stopGoalMonitoring();
        browserService.closeBrowser();
        bot.stop('SIGINT');
      });
      
      process.once('SIGTERM', () => {
        console.log('SIGTERM received. Shutting down gracefully...');
        clearInterval(servicesRestartInterval);
        memoryService.stopCleanupRoutines();
        notifierService.stopNotifier();
        goalMonitorService.stopGoalMonitoring();
        browserService.closeBrowser();
        bot.stop('SIGTERM');
      });
      
    } catch (err) {
      console.error('Error during startup:', err);
    }
    
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