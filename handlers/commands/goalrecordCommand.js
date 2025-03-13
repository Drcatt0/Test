/**
 * Enhanced Goal Record Command Handler
 * Configures continuous real-time goal monitoring and recording
 */
const premiumUsersModel = require('../../models/premiumUsers');
const monitoredUsersModel = require('../../models/monitoredUsers');
const autoRecordConfigModel = require('../../models/autoRecordConfig');
const goalMonitorService = require('../../services/goalMonitorService');

// Maximum auto-record monitors per user
const MAX_GOAL_MONITORS = 3;

/**
 * /goalrecord - Configure automatic goal recording with enhanced monitoring
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
      : "None (add streamers to monitor goals)";
    
    // Count active monitors
    const activeMonitors = Array.from(goalMonitorService.activeGoalMonitors.keys())
      .filter(username => userConfig.usernames.some(u => u.toLowerCase() === username.toLowerCase()));
      
    return ctx.reply(
      "🎯 *Enhanced Goal Recording Settings*\n\n" +
      `Status: ${status}\n` +
      `Recording Duration: ${duration}\n` +
      `Monitored Streamers (${userConfig.usernames.length}/${MAX_GOAL_MONITORS}): ${streamers}\n` + 
      `Active Monitors: ${activeMonitors.length}\n\n` +
      "Commands:\n" +
      "• /goalrecord on - Enable goal recording\n" +
      "• /goalrecord off - Disable goal recording\n" +
      "• /goalrecord duration [seconds] - Set recording duration\n" +
      "• /goalrecord add [username] - Add streamer to goal monitoring\n" +
      "• /goalrecord remove [username] - Remove streamer from goal monitoring\n" +
      "• /goalrecord clear - Clear all monitored streamers\n" +
      "• /goalrecord check - Check current goal status of monitored streamers",
      { parse_mode: 'Markdown' }
    );
  }
  
  // Process commands
  const command = args[0].toLowerCase();
  
  switch (command) {
    case 'on':
      await autoRecordConfigModel.enableAutoRecording(userId, chatId);
      
      // Start monitoring for all usernames
      if (userConfig.usernames && userConfig.usernames.length > 0) {
        userConfig.usernames.forEach(username => {
          goalMonitorService.startMonitoringGoal(username, [chatId], [userId]);
        });
      }
      
      return ctx.reply("✅ Enhanced goal recording is now enabled!");
      
    case 'off':
      await autoRecordConfigModel.disableAutoRecording(userId);
      
      // Stop monitoring (but don't remove from configuration)
      if (userConfig.usernames && userConfig.usernames.length > 0) {
        userConfig.usernames.forEach(username => {
          // Only stop monitoring for this user ID
          const monitor = goalMonitorService.activeGoalMonitors.get(username.toLowerCase());
          if (monitor) {
            // Remove this user ID from the monitor
            monitor.userIds.delete(userId);
            
            // If no more user IDs for this user, stop monitoring
            if (monitor.userIds.size === 0) {
              goalMonitorService.stopMonitoringGoal(username);
            }
          }
        });
      }
      
      return ctx.reply("❌ Enhanced goal recording is now disabled!");
      
    case 'duration':
      if (args.length < 2) {
        return ctx.reply("⚠️ Please specify the duration in seconds. Example: /goalrecord duration 180");
      }
      
      const duration = parseInt(args[1], 10);
      const result = await autoRecordConfigModel.setAutoRecordingDuration(userId, duration);
      
      if (!result.success) {
        return ctx.reply(`⚠️ ${result.message}`);
      }
      
      return ctx.reply(`✅ Goal recording duration set to ${duration} seconds.`);
      
    case 'add':
      if (args.length < 2) {
        return ctx.reply("⚠️ Please specify a username. Example: /goalrecord add AlicePlayss");
      }
      
      const usernameToAdd = args[1].trim();
      
      // Check if already monitoring max number of streamers
      if (userConfig.usernames && userConfig.usernames.length >= MAX_GOAL_MONITORS) {
        return ctx.reply(`⚠️ You can only monitor up to ${MAX_GOAL_MONITORS} streamers for goal recording. Please remove some before adding more.`);
      }
      
      // Check if the username exists
      await ctx.reply(`🔍 Checking if ${usernameToAdd} exists...`);
      const status = await goalMonitorService.getStreamStatus(usernameToAdd);
      
      if (!status) {
        return ctx.reply(`❌ Could not find streamer: ${usernameToAdd}`);
      }
      
      // Check if user is already being monitored
      const isMonitored = monitoredUsersModel.getMonitoredUsersForChat(chatId)
        .some(u => u.username.toLowerCase() === usernameToAdd.toLowerCase());
      
      // Add to monitored users if not already
      if (!isMonitored) {
        await ctx.reply(`Adding ${usernameToAdd} to your monitoring list first...`);
        await monitoredUsersModel.addMonitoredUser(usernameToAdd, chatId);
      }
      
      // Add to specific list for goal recording
      const addResult = await autoRecordConfigModel.addUsernameToAutoRecord(userId, usernameToAdd);
      
      if (!addResult.success) {
        return ctx.reply(`ℹ️ ${addResult.message}`);
      }
      
      // Enable goal recording if not already
      if (!userConfig.enabled) {
        await autoRecordConfigModel.enableAutoRecording(userId, chatId);
      }
      
      // Start monitoring goals for this user
      goalMonitorService.startMonitoringGoal(usernameToAdd, [chatId], [userId]);
      
      // Check current status
      await ctx.reply(`✅ Added ${usernameToAdd} to your goal recording list. Checking current status...`);
      
      try {
        if (status.isLive) {
          let statusMsg = `🔴 ${usernameToAdd} is currently LIVE!`;
          
          if (status.goal && status.goal.active) {
            const progressPercentage = Math.floor(status.goal.progress);
            const progressBar = generateProgressBar(progressPercentage);
            
            statusMsg += `\n\n🎯 Current Goal Progress: ${progressBar} ${progressPercentage}%`;
            
            if (status.goal.text) {
              statusMsg += `\nGoal: ${status.goal.text}`;
            }
            
            statusMsg += `\n\nYou will be notified in real-time of goal progress and will record when completed!`;
          } else {
            statusMsg += `\n\nNo active goal detected at the moment. You will be notified when a goal is set and as it progresses.`;
          }
          
          await ctx.reply(statusMsg);
        } else {
          await ctx.reply(`${usernameToAdd} is not currently live. You will be notified when they go live and set goals.`);
        }
      } catch (error) {
        console.error(`Error checking status for ${usernameToAdd}:`, error);
      }
      
      return;
      
    case 'remove':
      if (args.length < 2) {
        return ctx.reply("⚠️ Please specify a username. Example: /goalrecord remove AlicePlayss");
      }
      
      const usernameToRemove = args[1].trim();
      
      // Remove from goal monitoring service
      goalMonitorService.stopMonitoringGoal(usernameToRemove);
      
      // Remove from specific list
      const removeResult = await autoRecordConfigModel.removeUsernameFromAutoRecord(userId, usernameToRemove);
      
      if (!removeResult.success) {
        return ctx.reply(`ℹ️ ${removeResult.message}`);
      }
      
      return ctx.reply(`✅ Removed ${usernameToRemove} from your goal recording list.`);
      
    case 'clear':
      // Get current usernames
      if (userConfig.usernames && userConfig.usernames.length > 0) {
        // Stop monitoring for all usernames
        userConfig.usernames.forEach(username => {
          goalMonitorService.stopMonitoringGoal(username);
        });
      }
      
      await autoRecordConfigModel.clearAutoRecordUsernames(userId);
      return ctx.reply("✅ Cleared your goal recording list.");
      
    case 'check':
      // Get the list of monitored usernames
      if (!userConfig.usernames || userConfig.usernames.length === 0) {
        return ctx.reply("⚠️ You are not monitoring any streamers for goal recording. Use /goalrecord add [username] to add a streamer.");
      }
      
      await ctx.reply("🔍 Checking current goal status for your monitored streamers...");
      
      // Check each username using the goal monitor service
      const statusChecks = await Promise.all(userConfig.usernames.map(async (username) => {
        try {
          const status = await goalMonitorService.getStreamStatus(username);
          return { username, status };
        } catch (error) {
          console.error(`Error checking status for ${username}:`, error);
          return { username, error: true };
        }
      }));
      
      // Format the results
      let message = "🎯 *Current Goal Status*\n\n";
      
      for (const check of statusChecks) {
        message += `*${check.username}*: `;
        
        if (check.error) {
          message += "Error checking status\n\n";
          continue;
        }
        
        if (!check.status.isLive) {
          message += "Offline\n\n";
          continue;
        }
        
        message += "🔴 LIVE\n";
        
        if (check.status.goal && check.status.goal.active) {
          const progressPercentage = Math.floor(check.status.goal.progress);
          const progressBar = generateProgressBar(progressPercentage);
          
          message += `Progress: ${progressBar} ${progressPercentage}%\n`;
          
          if (check.status.goal.text) {
            message += `Goal: ${check.status.goal.text}\n`;
          }
          
          if (check.status.goal.completed) {
            message += "✅ Goal completed!\n";
          }
        } else {
          message += "No active goal detected\n";
        }
        
        message += "\n";
      }
      
      message += "Goal recording is " + (userConfig.enabled ? "✅ ENABLED" : "❌ DISABLED");
      
      return ctx.reply(message, { parse_mode: 'Markdown' });
      
    default:
      return ctx.reply(
        "⚠️ Unknown command. Valid commands are:\n" +
        "• /goalrecord on - Enable goal recording\n" +
        "• /goalrecord off - Disable goal recording\n" +
        "• /goalrecord duration [seconds] - Set recording duration\n" +
        "• /goalrecord add [username] - Add streamer to goal monitoring\n" +
        "• /goalrecord remove [username] - Remove streamer from goal monitoring\n" +
        "• /goalrecord clear - Clear all monitored streamers\n" +
        "• /goalrecord check - Check current goal status of monitored streamers"
      );
  }
}

/**
 * Generate a visual progress bar
 */
function generateProgressBar(percentage, length = 10) {
  const progress = Math.floor((percentage / 100) * length);
  const filled = '█'.repeat(progress);
  const empty = '░'.repeat(length - progress);
  return filled + empty;
}

module.exports = {
  handler
};