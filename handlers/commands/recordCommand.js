/**
 * Record Command Handler
 */
const recordService = require('../../services/recordService');

/**
 * /record - Record a live stream
 */
async function handler(ctx) {
  const args = ctx.message.text.split(' ').slice(1);
  
  if (args.length < 2) {
    return ctx.reply("⚠️ Usage: /record username duration_in_seconds\n\nExample: /record AlicePlayss 60");
  }

  const username = args[0];
  const duration = parseInt(args[1], 10);
  
  if (isNaN(duration) || duration <= 0) {
    return ctx.reply("⚠️ Please provide a valid duration in seconds.");
  }
  
  await recordService.executeRecord(ctx, username, duration);
}

module.exports = {
  handler
};
