/**
 * Autorecord Command Handler
 */
const premiumUsersModel = require('../../models/premiumUsers');
const autoRecordConfigModel = require('../../models/autoRecordConfig');
const monitoredUsersModel = require('../../models/monitoredUsers');

/**
 * /autorecord - Configure automatic goal recording (premium users only)
 */
async function handler(ctx) {
  const userId = ctx.message.from.id;
  const chatId = ctx.message.chat.id;
  const args = ctx.message.text.split(' ').slice(1);
  
  // Check if user has premium
  if (!premiumUsersModel.isPremiumUser(userId)) {
    return ctx.reply(
      "⭐ *Premium Feature*\n\n" +
      "Auto recording of streamer goals is a premium feature. Upgrade to premium to use this feature!\n\n" +
      "Type /premium for more information.",
      { parse_mode: 'Markdown' }
    );
  }
  
  // Get current config
  let userConfig = autoRecordConfigModel.getUserAutoRecordConfig(userId);
  
  // Initialize config for this user if needed
  if (!userConfig) {
    userConfig = {
      enabled: false,
      duration: 180, // Default 3 minutes
      chatId: chatId.toString(),
      lastNotification: null,
      usernames: []
    };
    
    await autoRecordConfigModel.setUserAutoRecordConfig(userId, chatId, userConfig);
  }
  
  // Parse the command
  if (args.length === 0) {
    // Show current settings
    const status = userConfig.enabled ? "✅ Enabled" : "❌ Disabled";
    const duration = userConfig.duration + " seconds";
    const streamers = userConfig.usernames.length > 0 
      ? userConfig.usernames.join(", ") 
      : "None (all monitored streamers will be auto-recorded)";
    
    return ctx.reply(
      "🔄 *Auto Recording Settings*\n\n" +
      `Status: ${status}\n` +
      `Recording Duration: ${duration}\n` +
      `Specific Streamers: ${streamers}\n\n` +
      "Commands:\n" +
      "• /autorecord on - Enable auto recording\n" +
      "• /autorecord off - Disable auto recording\n" +
      "• /autorecord duration [seconds] - Set recording duration\n" +
      "• /autorecord add [username] - Add specific streamer\n" +
      "• /autorecord remove [username] - Remove specific streamer\n" +
      "• /autorecord clear - Clear specific streamer list",
      { parse_mode: 'Markdown' }
    );
  }
  
  // Process commands
  const command = args[0].toLowerCase();
  
  switch (command) {
    case 'on':
      await autoRecordConfigModel.enableAutoRecording(userId, chatId);
      return ctx.reply("✅ Auto recording of goal completions is now enabled!");
      
    case 'off':
      await autoRecordConfigModel.disableAutoRecording(userId);
      return ctx.reply("❌ Auto recording of goal completions is now disabled!");
      
    case 'duration':
      if (args.length < 2) {
        return ctx.reply("⚠️ Please specify the duration in seconds. Example: /autorecord duration 180");
      }
      
      const duration = parseInt(args[1], 10);
      const result = await autoRecordConfigModel.setAutoRecordingDuration(userId, duration);
      
      if (!result.success) {
        return ctx.reply(`⚠️ ${result.message}`);
      }
      
      return ctx.reply(`✅ Auto recording duration set to ${duration} seconds.`);
      
    case 'add':
      if (args.length < 2) {
        return ctx.reply("⚠️ Please specify a username. Example: /autorecord add AlicePlayss");
      }
      
      const usernameToAdd = args[1].trim();
      
      // Check if user is already being monitored
      const isMonitored = monitoredUsersModel.getMonitoredUsersForChat(chatId)
        .some(u => u.username.toLowerCase() === usernameToAdd.toLowerCase());
      
      if (!isMonitored) {
        return ctx.reply(`⚠️ You're not monitoring ${usernameToAdd}. Please add them to your monitoring list first using /add ${usernameToAdd}`);
      }
      
      // Add to specific list
      const addResult = await autoRecordConfigModel.addUsernameToAutoRecord(userId, usernameToAdd);
      
      if (!addResult.success) {
        return ctx.reply(`ℹ️ ${addResult.message}`);
      }
      
      return ctx.reply(`✅ Added ${usernameToAdd} to your auto-record list. Goals by this streamer will now be automatically recorded.`);
      
    case 'remove':
      if (args.length < 2) {
        return ctx.reply("⚠️ Please specify a username. Example: /autorecord remove AlicePlayss");
      }
      
      const usernameToRemove = args[1].trim();
      
      // Remove from specific list
      const removeResult = await autoRecordConfigModel.removeUsernameFromAutoRecord(userId, usernameToRemove);
      
      if (!removeResult.success) {
        return ctx.reply(`ℹ️ ${removeResult.message}`);
      }
      
      return ctx.reply(`✅ Removed ${usernameToRemove} from your auto-record list.`);
      
    case 'clear':
      await autoRecordConfigModel.clearAutoRecordUsernames(userId);
      return ctx.reply("✅ Cleared your specific streamer list. Goals by all monitored streamers will be auto-recorded.");
      
    default:
      return ctx.reply(
        "⚠️ Unknown command. Valid commands are:\n" +
        "• /autorecord on - Enable auto recording\n" +
        "• /autorecord off - Disable auto recording\n" +
        "• /autorecord duration [seconds] - Set recording duration\n" +
        "• /autorecord add [username] - Add specific streamer\n" +
        "• /autorecord remove [username] - Remove specific streamer\n" +
        "• /autorecord clear - Clear specific streamer list"
      );
  }
}

module.exports = {
  handler
};
