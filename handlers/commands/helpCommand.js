/**
 * Help Command Handler
 * Shows available commands and bot support information
 */
const { Markup } = require('telegraf');

/**
 * /help Command - Shows all available commands and support info
 */
async function handler(ctx) {
  const message = 
    "🤖 *Stripchat Monitor Bot Help*\n\n" +
    "📋 *Available Commands:*\n\n" +
    
    "🔍 *General Commands:*\n" +
    "• /add username - Add a streamer to monitor (up to 10)\n" +
    "• /list - Show all your monitored streamers\n" +
    "• /remove username - Stop monitoring a streamer\n" +
    "• /info username - Get detailed info about a streamer\n" +
    "• /popular - View popular live streamers\n" +
    "• /help - Show this help message\n\n" +
    
    "🎬 *Recording Commands:*\n" +
    "• /record username seconds - Record a live stream\n" +
    "  (Free: 45 seconds max with 3 min cooldown)\n" +
    "  (Premium: Up to 20 minutes with no cooldown)\n" +
    "• /extend seconds - Extend a current recording\n" +
    "• /progress - Check recording progress\n\n" +
    
    "✨ *Premium Commands:*\n" +
    "• /premium - View premium features & upgrade\n" +
    "• /goalrecord - Auto-record when goals complete (up to 3 streamers)\n" +
    "• /search category - Search streamers by category\n\n" +
    
    "🛠️ *Need Help?*\n" +
    "Contact @drcatto for support or feature requests.\n\n" +
    
    "This bot is intended for adults over the age of 18 only.\n" +
    "By using this bot, you confirm you are of legal age in your jurisdiction.";
  
  // Create keyboard with commonly used commands
  const keyboard = Markup.keyboard([
    ['📋 /list', '🔍 /popular'],
    ['📥 /add', '📤 /remove'],
    ['🎬 /record', '📊 /info'],
    ['💎 /premium', '🎯 /goalrecord']
  ]).resize();
  
  await ctx.reply(message, {
    parse_mode: 'Markdown',
    ...keyboard
  });
}

module.exports = {
  handler
};