/**
 * Add Command Handler
 */
const monitoredUsersModel = require('../../models/monitoredUsers');
const monitorService = require('../../services/monitorService');

/**
 * /add - Add a user to the monitored list
 */
async function handler(ctx) {
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length < 1) {
    return ctx.reply("⚠️ Usage: /add username\n\nExample: /add AlicePlayss");
  }

  const username = args[0];
  const chatId = ctx.message.chat.id;

  // Check if already monitored
  const monitoredUsers = monitoredUsersModel.getMonitoredUsersForChat(chatId);
  const alreadyMonitored = monitoredUsers.some(
    user => user.username.toLowerCase() === username.toLowerCase()
  );
  
  if (alreadyMonitored) {
    return ctx.reply(`⚠️ You're already monitoring ${username}.`);
  }

  await ctx.reply(`🔍 Checking if ${username} exists...`);
  
  // Validate the username exists before adding
  const exists = await monitorService.checkUsernameExists(username);
  
  if (!exists) {
    return ctx.reply(`❌ Could not find streamer: ${username}`);
  }

  // Add the user to monitored list
  const result = await monitoredUsersModel.addMonitoredUser(username, chatId);
  
  if (!result.success) {
    return ctx.reply(`❌ Error adding ${username}: ${result.message}`);
  }
  
  // Check and notify about current status
  try {
    await monitorService.checkAndNotify(username, chatId, ctx.telegram);
  } catch (error) {
    console.error("Error in initial check:", error);
  }

  return ctx.reply(`✅ Added ${username} to your monitoring list. You'll be notified when they go live.`);
}

module.exports = {
  handler
};
