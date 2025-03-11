/**
 * Main Entry Point for Stripchat Monitor Bot
 */
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const { Telegraf } = require('telegraf');
const fs = require('fs-extra');
const path = require('path');
const config = require('./config/config');

// Import handlers
const commandHandler = require('./handlers/commandHandler');
const messageHandler = require('./handlers/messageHandler');

// Import services
const monitorService = require('./services/monitorService');
const memoryService = require('./services/memoryService');
const browserService = require('./services/browserService');

// Initialize the bot
const bot = new Telegraf(config.BOT_TOKEN);

// Ensure data directory exists
(async () => {
  try {
    const dataDir = path.join(__dirname, 'data');
    await fs.ensureDir(dataDir);
    console.log('Data directory is ready');
  } catch (err) {
    console.error('Error ensuring data directory exists:', err);
  }
})();

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
bot.launch().then(async () => {
  console.log("Telegram bot is up and running!");
  
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
}).catch(err => {
  console.error('Failed to launch bot:', err);
});