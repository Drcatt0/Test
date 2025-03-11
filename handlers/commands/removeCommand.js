/**
 * Remove Command Handler
 */
const monitoredUsersModel = require('../../models/monitoredUsers');

/**
 * /remove - Remove a user from monitored list
 */
async function handler(ctx) {
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length < 1) {
    return ctx.reply("⚠️ Usage: /remove username\n\nExample: /remove AlicePlayss");
  }

  const username = args[0];
  const chatId = ctx.message.chat.id;

  const result = await monitoredUsersModel.removeMonitoredUser(username, chatId);
  
  if (!result.success) {
    return ctx.reply(`❌ ${result.message}`);
  }

  return ctx.reply(`✅ Stopped monitoring ${username}.`);
}

/**
 * Handle inline button action to remove a user
 */
async function handleRemoveAction(ctx, username, chatId) {
  const result = await monitoredUsersModel.removeMonitoredUser(username, chatId);
  
  if (!result.success) {
    return ctx.answerCbQuery(`User ${username} not found or already removed.`);
  }

  await ctx.answerCbQuery(`✅ Stopped monitoring ${username}.`, { show_alert: true });
  await ctx.editMessageText(`✅ Removed ${username} from your monitoring list.`);
}

module.exports = {
  handler,
  handleRemoveAction,
  actions: [
    {
      pattern: /^removeUser:(.+):(-?\d+)$/,
      handler: async (ctx) => {
        const username = ctx.match[1];
        const chatId = parseInt(ctx.match[2], 10);
        await handleRemoveAction(ctx, username, chatId);
      }
    }
  ]
};
