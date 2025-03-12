// In handlers/commands/listCommand.js

const { Markup } = require('telegraf');
const monitorService = require('../../services/monitorService');
const monitoredUsersModel = require('../../models/monitoredUsers');
const premiumUsersModel = require('../../models/premiumUsers');
const autoRecordConfigModel = require('../../models/autoRecordConfig');

/**
 * Handler for the /list command
 */
async function handler(ctx) {
  const chatId = ctx.message.chat.id;
  const userId = ctx.message.from.id;
  const monitoredUsers = monitoredUsersModel.getAllMonitoredUsers();
  const subbedUsers = monitoredUsers.filter(u => u.chatId === chatId);

  if (subbedUsers.length === 0) {
    return ctx.reply("📋 No streamers are being monitored in this chat.");
  }

  // Send initial message and show loading indicator
  const loadingMsg = await ctx.reply("🔄 Fetching current statuses for all streamers...");
  
  try {
    // Process users in batches to prevent memory issues
    const userBatchSize = 3; // Process 3 at a time
    let updatedUsers = [];
    
    // Process in batches
    for (let i = 0; i < subbedUsers.length; i += userBatchSize) {
      const batch = subbedUsers.slice(i, i + userBatchSize);
      
      // Update loading message to show progress
      if (subbedUsers.length > userBatchSize) {
        await ctx.telegram.editMessageText(
          chatId, 
          loadingMsg.message_id, 
          undefined, 
          `🔄 Fetching streamer statuses... (${Math.min(i + userBatchSize, subbedUsers.length)}/${subbedUsers.length})`
        );
      }
      
      // Fetch current status for each user in the batch
      const batchResults = await Promise.all(batch.map(async (user) => {
        try {
          console.log(`Checking status for ${user.username} in /list command...`);
          const currentStatus = await monitorService.checkStripchatStatus(user.username);
          console.log(`Status for ${user.username}: Live=${currentStatus.isLive}, Goal=${currentStatus.goal.active ? `Progress: ${currentStatus.goal.progress}%` : 'None'}`);
          return {
            ...user,
            currentStatus
          };
        } catch (error) {
          console.error(`Error fetching status for ${user.username}:`, error);
          return user; // Return original user data if fetch fails
        }
      }));
      
      updatedUsers = [...updatedUsers, ...batchResults];
      
      // Small delay between batches to reduce load
      if (i + userBatchSize < subbedUsers.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Build the final message
    let message = "📋 *Monitored Streamers:*\n\n";
    const inlineKeyboard = [];
    
    // Check if user is premium for auto-record buttons
    const isPremium = premiumUsersModel.isPremiumUser(userId);
    
    // Get user's current auto-record config
    const autoRecordConfig = isPremium ? 
      autoRecordConfigModel.getUserAutoRecordConfig(userId) || { usernames: [] } : 
      { usernames: [] };
    
    updatedUsers.forEach((user, index) => {
      // Basic status information
      const isCurrentlyLive = user.currentStatus?.isLive || user.isLive;
      const status = isCurrentlyLive ? "🟢 LIVE" : "⚫ Offline";
      const lastChecked = "Just now";
      
      // Start building this user's entry
      message += `${index + 1}. *${user.username}* - ${status}\n`;
      
      // Add goal information if available
      if (isCurrentlyLive && user.currentStatus?.goal?.active) {
        const goal = user.currentStatus.goal;
        console.log(`Formatting goal for ${user.username}: Progress=${goal.progress}, Text=${goal.text}`); 
        
        const progressBar = monitorService.generateProgressBar(goal.progress);
        const progressPercentage = Math.floor(goal.progress);
        
        message += `   ${progressBar} ${progressPercentage}%\n`;
        
        // Add token information if available
        if (goal.currentAmount > 0) {
          message += `   💰 *Tokens:* ${goal.currentAmount} tk\n`;
        }
        
        // Add goal text if available - sanitize to prevent emoji issues
        if (goal.text) {
          // Replace problematic emoji/text with safer alternatives
          const sanitizedText = goal.text
            .replace(/BRA|bra|👙/g, "👚") // Replace bra text/emoji with shirt emoji
            .replace(/TAKE OFF/g, "OUTFIT") // Replace "TAKE OFF" with "OUTFIT"
            .replace(/OFF/g, "") // Remove standalone "OFF" text
            .replace(/TAKE/g, "") // Remove standalone "TAKE" text
            .replace(/🚫|⛔|🔞/g, "") // Remove prohibition emojis
            .replace(/\s+/g, " ") // Normalize spaces
            .trim(); // Trim extra spaces
          
          message += `   🎯 *Goal:* ${sanitizedText || "Special Goal"}\n`;
        }
        
        if (goal.completed) {
          message += `   ✅ *Goal completed!*\n`;
        }
      }
      
      // Add last checked time
      message += `   _Last checked: ${lastChecked}_\n\n`;
      
      // Check if this user is already in auto-record
      const isAutoRecorded = autoRecordConfig.usernames && 
                           autoRecordConfig.usernames.some(u => 
                             u.toLowerCase() === user.username.toLowerCase());
      
      // Add action buttons
      const buttons = [];
      
      // Add remove button
      buttons.push(
        Markup.button.callback(`🗑️ Remove`, `removeUser:${user.username}:${chatId}`)
      );
      
      // Add record button
      buttons.push(
        Markup.button.callback(`🎬 Record`, `quickRecord:${user.username}:${chatId}`)
      );
      
      // Add auto-record toggle button if premium
      if (isPremium) {
        const autoRecordText = isAutoRecorded ? 
          `❌ Remove Auto` : 
          `🔄 Add Auto`;
        
        buttons.push(
          Markup.button.callback(autoRecordText, `toggleAutoRecord:${user.username}:${chatId}`)
        );
      }
      
      inlineKeyboard.push(buttons);
    });
    
    // Add refresh button
    inlineKeyboard.push([
      Markup.button.callback('🔄 Refresh Statuses', `refreshList:${chatId}`)
    ]);
    
    // Add auto-record status button if premium
    if (isPremium) {
      const autoEnabled = autoRecordConfig.enabled ? "✅" : "❌";
      inlineKeyboard.push([
        Markup.button.callback(
          `${autoEnabled} Auto-Record: ${autoRecordConfig.enabled ? "ON" : "OFF"}`, 
          `toggleAutoRecordStatus:${chatId}`
        )
      ]);
    }
    
    // Delete loading message and send the final list
    await ctx.telegram.deleteMessage(chatId, loadingMsg.message_id);
    
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: inlineKeyboard }
    });
  } catch (error) {
    console.error("Error fetching streamer statuses:", error);
    await ctx.telegram.editMessageText(
      chatId, 
      loadingMsg.message_id, 
      undefined, 
      "❌ Error fetching streamer statuses. Please try again."
    );
  }
}

// Action handler for the refresh button
async function handleRefreshAction(ctx) {
  const chatId = parseInt(ctx.match[1], 10);
  
  // Re-run the handler with the chat ID
  await handler({
    message: { chat: { id: chatId }, from: { id: ctx.from.id } },
    telegram: ctx.telegram,
    reply: ctx.telegram.sendMessage.bind(ctx.telegram, chatId)
  });
  
  // Answer the callback query
  await ctx.answerCbQuery('Refreshed streamer statuses');
}

// Action handler for quick record button
async function handleQuickRecordAction(ctx) {
  const username = ctx.match[1];
  const chatId = parseInt(ctx.match[2], 10);
  const userId = ctx.from.id;
  
  // Get default recording duration
  const isPremium = premiumUsersModel.isPremiumUser(userId);
  const duration = isPremium ? 120 : config.FREE_USER_MAX_DURATION;
  
  await ctx.answerCbQuery(`Starting ${duration}s recording of ${username}...`);
  
  // Create a mock context for the record service
  const mockCtx = {
    message: { 
      chat: { id: chatId },
      from: { id: userId },
      text: `/record ${username} ${duration}`
    },
    telegram: ctx.telegram,
    reply: ctx.telegram.sendMessage.bind(ctx.telegram, chatId),
    replyWithVideo: (data) => ctx.telegram.sendVideo(chatId, data.source, { caption: data.caption })
  };
  
  // Call the record service
  const recordService = require('../../services/recordService');
  await recordService.executeRecord(mockCtx, username, duration);
}

// Action handler for toggling auto-record for a user
async function handleToggleAutoRecordAction(ctx) {
  const username = ctx.match[1];
  const chatId = parseInt(ctx.match[2], 10);
  const userId = ctx.from.id;
  
  // Check if user has premium
  if (!premiumUsersModel.isPremiumUser(userId)) {
    return ctx.answerCbQuery(
      "⭐ Auto recording is a premium feature. Use /premium to upgrade.",
      { show_alert: true }
    );
  }
  
  // Get current config
  let userConfig = autoRecordConfigModel.getUserAutoRecordConfig(userId);
  
  // Initialize config for this user if needed
  if (!userConfig) {
    userConfig = {
      enabled: true,
      duration: 180, // Default 3 minutes
      chatId: chatId.toString(),
      lastNotification: null,
      usernames: []
    };
    
    await autoRecordConfigModel.setUserAutoRecordConfig(userId, chatId, userConfig);
  }
  
  // Check if username already in auto-record list
  const isAutoRecorded = userConfig.usernames && 
                         userConfig.usernames.some(u => 
                           u.toLowerCase() === username.toLowerCase());
  
  let result;
  
  if (isAutoRecorded) {
    // Remove from auto-record
    result = await autoRecordConfigModel.removeUsernameFromAutoRecord(userId, username);
    if (result.success) {
      await ctx.answerCbQuery(`Removed ${username} from auto-record`, { show_alert: true });
    } else {
      await ctx.answerCbQuery(`Error: ${result.message}`, { show_alert: true });
    }
  } else {
    // Add to auto-record
    if (!userConfig.enabled) {
      await autoRecordConfigModel.enableAutoRecording(userId, chatId);
    }
    
    result = await autoRecordConfigModel.addUsernameToAutoRecord(userId, username);
    
    if (result.success) {
      await ctx.answerCbQuery(`Added ${username} to auto-record list`, { show_alert: true });
    } else {
      await ctx.answerCbQuery(`Error: ${result.message}`, { show_alert: true });
    }
  }
  
  // Refresh the list to update buttons
  await handleRefreshAction(ctx);
}

// Action handler for toggling auto-record status
async function handleToggleAutoRecordStatusAction(ctx) {
  const chatId = parseInt(ctx.match[1], 10);
  const userId = ctx.from.id;
  
  // Check if user has premium
  if (!premiumUsersModel.isPremiumUser(userId)) {
    return ctx.answerCbQuery(
      "⭐ Auto recording is a premium feature. Use /premium to upgrade.",
      { show_alert: true }
    );
  }
  
  // Get current config
  let userConfig = autoRecordConfigModel.getUserAutoRecordConfig(userId);
  
  if (!userConfig) {
    // Create new config if none exists
    await autoRecordConfigModel.enableAutoRecording(userId, chatId);
    await ctx.answerCbQuery("Auto-recording enabled!", { show_alert: true });
  } else {
    // Toggle status
    if (userConfig.enabled) {
      await autoRecordConfigModel.disableAutoRecording(userId);
      await ctx.answerCbQuery("Auto-recording disabled", { show_alert: true });
    } else {
      await autoRecordConfigModel.enableAutoRecording(userId, chatId);
      await ctx.answerCbQuery("Auto-recording enabled!", { show_alert: true });
    }
  }
  
  // Refresh the list to update buttons
  await handleRefreshAction(ctx);
}

module.exports = {
  handler,
  actions: [
    {
      pattern: /^refreshList:(-?\d+)$/,
      handler: handleRefreshAction
    },
    {
      pattern: /^quickRecord:(.+):(-?\d+)$/,
      handler: handleQuickRecordAction
    },
    {
      pattern: /^toggleAutoRecord:(.+):(-?\d+)$/,
      handler: handleToggleAutoRecordAction
    },
    {
      pattern: /^toggleAutoRecordStatus:(-?\d+)$/,
      handler: handleToggleAutoRecordStatusAction
    }
  ]
};
module.exports = { handler };