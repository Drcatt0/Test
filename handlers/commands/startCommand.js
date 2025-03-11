/**
 * Start Command Handler
 */
const { Markup } = require('telegraf');

/**
 * /start Command - Shows commands and sets up a keyboard
 */
async function handler(ctx) {
  const welcomeMessage = 
    "👋 Welcome to the Stripchat Monitor Bot!\n\n" +
    "Available commands:\n" +
    "• /add username - Add a streamer to monitor\n" +
    "• /remove username - Remove a monitored streamer\n" +
    "• /list - Show all monitored streamers\n" +
    "• /record username seconds - Record a live stream\n" +
    "• /premium - View premium features & upgrade options\n" +
    "• /autorecord - Configure automatic goal recording (premium)\n\n" +
    "Use the buttons below for quick access:";
    
  await ctx.reply(welcomeMessage, 
    Markup.keyboard([
      ['📥 /add', '📋 /list'],
      ['📤 /remove', '🎬 /record'],
      ['💎 /premium', '🔄 /autorecord']
    ]).resize()
  );
}

module.exports = {
  handler
};
