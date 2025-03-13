/**
 * Fixed List Command - With chat ID error handling
 */
const { Markup } = require('telegraf');
const monitorService = require('../../services/monitorService');
const monitoredUsersModel = require('../../models/monitoredUsers');
const premiumUsersModel = require('../../models/premiumUsers');
const autoRecordConfigModel = require('../../models/autoRecordConfig');
const config = require('../../config/config');

/**
 * Handler for the /list command
 * This version doesn't use message editing which was causing errors
 */
async function handler(ctx) {
  const chatId = ctx.message.chat.id;
  const userId = ctx.message.from.id;
  const monitoredUsers = monitoredUsersModel.getAllMonitoredUsers();
  const subbedUsers = monitoredUsers.filter(u => u.chatId === chatId);

  if (subbedUsers.length === 0) {
    return ctx.reply("📋 No streamers are being monitored in this chat.");
  }

  // Send initial message
  await ctx.reply("🔍 Getting streamer statuses... This may take a moment.");
  
  try {
    // Process users in batches to check their current status
    const batchSize = 3;
    let updatedUsers = [];
    
    // Process users in small batches first to make command more responsive
    for (let i = 0; i < subbedUsers.length; i += batchSize) {
      const batch = subbedUsers.slice(i, i + batchSize);
      
      // Process batch in parallel
      const batchResults = await Promise.all(batch.map(async (user) => {
        try {
          console.log(`Checking status for ${user.username} in /list command...`);
          const status = await monitorService.checkStripchatStatus(user.username);
          
          return {
            ...user,
            isLive: status.isLive,
            hasGoal: status.goal?.active || false,
            goalProgress: status.goal?.progress || 0,
            goalText: status.goal?.text || '',
            goalCompleted: status.goal?.completed || false,
            lastChecked: new Date().toISOString()
          };
        } catch (error) {
          console.error(`Error fetching status for ${user.username}:`, error);
          return user; // Return original user data if fetch fails
        }
      }));
      
      updatedUsers = [...updatedUsers, ...batchResults];
      
      // Save the updated status information
      for (const updatedUser of batchResults) {
        const index = monitoredUsers.findIndex(u => 
          u.username === updatedUser.username && u.chatId === updatedUser.chatId);
        if (index !== -1) {
          monitoredUsers[index] = updatedUser;
        }
      }
      await monitoredUsersModel.saveMonitoredUsers();
    }
    
    // Build the message with fresh status data
    let message = "📋 *Monitored Streamers:*\n\n";
    const inlineKeyboard = [];
    
    // Check if user is premium for auto-record buttons
    const isPremium = premiumUsersModel.isPremiumUser(userId);
    
    // Get user's current auto-record config
    const autoRecordConfig = isPremium ? 
      autoRecordConfigModel.getUserAutoRecordConfig(userId) || { usernames: [] } : 
      { usernames: [] };
    
    for (let i = 0; i < updatedUsers.length; i++) {
      const user = updatedUsers[i];
      // Basic status information
      const status = user.isLive ? "🟢 LIVE" : "⚫ Offline";
      const lastChecked = new Date(user.lastChecked).toLocaleString();
      
      // Start building this user's entry
      message += `${i + 1}. *${user.username}* - ${status}\n`;
      
      // Add goal information if available
      if (user.isLive && user.hasGoal) {
        // Fix the progress percentage calculation
        const progressPercentage = parseFloat(user.goalProgress) || 0;
        const formattedPercentage = Math.floor(progressPercentage);
        
        // Generate a more visible progress bar using the fixed function
        const progressBar = generateProgressBar(progressPercentage);
        message += `   ${progressBar} ${formattedPercentage}%\n`;
        
        // Add goal text if available
        if (user.goalText) {
          message += `   🎯 *Goal:* ${user.goalText}\n`;
        }
        
        if (user.goalCompleted) {
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
    }
    
    // Add refresh button - store chat ID directly, don't rely on regex parsing
    inlineKeyboard.push([
      Markup.button.callback('🔄 Refresh Status', `refreshList:${chatId}`)
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
    
    // Send the complete message with buttons
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: inlineKeyboard }
    });
    
  } catch (error) {
    console.error("Error getting streamer list:", error);
    await ctx.reply("❌ Error fetching streamer statuses. Please try again.");
  }
}

/**
 * Fixed progress bar generator function
 */
function generateProgressBar(percentage, length = 10) {
  // Make sure percentage is a number and between 0-100
  const numericPercentage = parseFloat(percentage) || 0;
  const normalizedPercentage = Math.max(0, Math.min(100, numericPercentage));
  
  // Calculate filled blocks
  const filled = Math.round((normalizedPercentage / 100) * length);
  
  // Create the bar with the correct number of filled and empty blocks
  const filledBlocks = '█'.repeat(filled);
  const emptyBlocks = '□'.repeat(length - filled);
  
  return filledBlocks + emptyBlocks;
}

/**
 * Action handler for the refresh button with improved error handling
 */
async function handleRefreshAction(ctx) {
  try {
    // Get the chat ID from the callback data with proper error handling
    let chatId;
    try {
      chatId = parseInt(ctx.match[1], 10);
      if (isNaN(chatId)) {
        // If chat ID is not a valid number, fall back to the current chat
        console.log("Invalid chat ID in refresh action, falling back to current chat");
        chatId = ctx.chat?.id;
        
        // If we still don't have a valid chatId, try to get it from update
        if (!chatId && ctx.update?.callback_query?.message?.chat?.id) {
          chatId = ctx.update.callback_query.message.chat.id;
        }
        
        // If still no chat ID, we can't proceed
        if (!chatId) {
          console.error("Unable to determine chat ID for refresh action");
          return ctx.answerCbQuery('Error: Unable to determine chat ID. Please try again.', { show_alert: true });
        }
      }
    } catch (error) {
      console.error("Error parsing chat ID in refresh action:", error);
      // Try to get the chat ID from the current context
      chatId = ctx.chat?.id || ctx.update?.callback_query?.message?.chat?.id;
      
      if (!chatId) {
        return ctx.answerCbQuery('Error: Unable to determine chat ID. Please try again.', { show_alert: true });
      }
    }
    
    // Answer the callback query first
    await ctx.answerCbQuery('Refreshing streamer statuses...');
    
    // Re-run the handler with the chat ID
    await handler({
      message: { 
        chat: { id: chatId }, 
        from: { id: ctx.from.id } 
      },
      telegram: ctx.telegram,
      reply: ctx.telegram.sendMessage.bind(ctx.telegram, chatId)
    });
  } catch (error) {
    console.error("Error in handleRefreshAction:", error);
    try {
      await ctx.answerCbQuery('An error occurred. Please try again.', { show_alert: true });
    } catch (e) {
      console.error("Error sending callback answer:", e);
    }
  }
}

/**
 * Action handler for quick record button with improved error handling
 */
async function handleQuickRecordAction(ctx) {
  try {
    const username = ctx.match[1];
    
    // Get the chat ID with proper error handling
    let chatId;
    try {
      chatId = parseInt(ctx.match[2], 10);
      if (isNaN(chatId)) {
        // Fall back to the current chat
        chatId = ctx.chat?.id;
        
        // If we still don't have a valid chatId, try to get it from update
        if (!chatId && ctx.update?.callback_query?.message?.chat?.id) {
          chatId = ctx.update.callback_query.message.chat.id;
        }
        
        if (!chatId) {
          console.error("Unable to determine chat ID for record action");
          return ctx.answerCbQuery('Error: Unable to determine chat ID. Please try again.', { show_alert: true });
        }
      }
    } catch (error) {
      console.error("Error parsing chat ID in record action:", error);
      chatId = ctx.chat?.id || ctx.update?.callback_query?.message?.chat?.id;
      
      if (!chatId) {
        return ctx.answerCbQuery('Error: Unable to determine chat ID. Please try again.', { show_alert: true });
      }
    }
    
    const userId = ctx.from.id;
    
    // Get default recording duration
    const isPremium = premiumUsersModel.isPremiumUser(userId);
    const duration = isPremium ? 120 : (config.FREE_USER_MAX_DURATION || 30);
    
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
  } catch (error) {
    console.error("Error in handleQuickRecordAction:", error);
    try {
      await ctx.answerCbQuery('An error occurred. Please try again.', { show_alert: true });
    } catch (e) {
      console.error("Error sending callback answer:", e);
    }
  }
}

/**
 * Action handler for toggling auto-record for a user with improved error handling
 */
async function handleToggleAutoRecordAction(ctx) {
  try {
    const username = ctx.match[1];
    
    // Get the chat ID with proper error handling
    let chatId;
    try {
      chatId = parseInt(ctx.match[2], 10);
      if (isNaN(chatId)) {
        // Fall back to the current chat
        chatId = ctx.chat?.id;
        
        // If we still don't have a valid chatId, try to get it from update
        if (!chatId && ctx.update?.callback_query?.message?.chat?.id) {
          chatId = ctx.update.callback_query.message.chat.id;
        }
        
        if (!chatId) {
          console.error("Unable to determine chat ID for toggle auto-record action");
          return ctx.answerCbQuery('Error: Unable to determine chat ID. Please try again.', { show_alert: true });
        }
      }
    } catch (error) {
      console.error("Error parsing chat ID in toggle auto-record action:", error);
      chatId = ctx.chat?.id || ctx.update?.callback_query?.message?.chat?.id;
      
      if (!chatId) {
        return ctx.answerCbQuery('Error: Unable to determine chat ID. Please try again.', { show_alert: true });
      }
    }
    
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
    
    // Create a fresh list instead of editing the current one
    try {
      // Use our improved refresh handler to regenerate the list
      await handler({
        message: { 
          chat: { id: chatId }, 
          from: { id: userId } 
        },
        telegram: ctx.telegram,
        reply: ctx.telegram.sendMessage.bind(ctx.telegram, chatId)
      });
    } catch (refreshError) {
      console.error("Error refreshing list after toggle auto-record:", refreshError);
    }
  } catch (error) {
    console.error("Error in handleToggleAutoRecordAction:", error);
    try {
      await ctx.answerCbQuery('An error occurred. Please try again.', { show_alert: true });
    } catch (e) {
      console.error("Error sending callback answer:", e);
    }
  }
}

/**
 * Action handler for toggling auto-record status with improved error handling
 */
async function handleToggleAutoRecordStatusAction(ctx) {
  try {
    // Get the chat ID with proper error handling
    let chatId;
    try {
      chatId = parseInt(ctx.match[1], 10);
      if (isNaN(chatId)) {
        // Fall back to the current chat
        chatId = ctx.chat?.id;
        
        // If we still don't have a valid chatId, try to get it from update
        if (!chatId && ctx.update?.callback_query?.message?.chat?.id) {
          chatId = ctx.update.callback_query.message.chat.id;
        }
        
        if (!chatId) {
          console.error("Unable to determine chat ID for toggle auto-record status action");
          return ctx.answerCbQuery('Error: Unable to determine chat ID. Please try again.', { show_alert: true });
        }
      }
    } catch (error) {
      console.error("Error parsing chat ID in toggle auto-record status action:", error);
      chatId = ctx.chat?.id || ctx.update?.callback_query?.message?.chat?.id;
      
      if (!chatId) {
        return ctx.answerCbQuery('Error: Unable to determine chat ID. Please try again.', { show_alert: true });
      }
    }
    
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
    
    // Create a fresh list instead of editing the current one
    try {
      // Use our improved handler to regenerate the list
      await handler({
        message: { 
          chat: { id: chatId }, 
          from: { id: userId } 
        },
        telegram: ctx.telegram,
        reply: ctx.telegram.sendMessage.bind(ctx.telegram, chatId)
      });
    } catch (refreshError) {
      console.error("Error refreshing list after toggle auto-record status:", refreshError);
    }
  } catch (error) {
    console.error("Error in handleToggleAutoRecordStatusAction:", error);
    try {
      await ctx.answerCbQuery('An error occurred. Please try again.', { show_alert: true });
    } catch (e) {
      console.error("Error sending callback answer:", e);
    }
  }
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