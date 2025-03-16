/**
 * Improved List Command with Two-Level Menu
 * FIXED: Properly displays goal information
 */
const { Markup } = require('telegraf');
const monitoredUsersModel = require('../../models/monitoredUsers');
const premiumUsersModel = require('../../models/premiumUsers');
const autoRecordConfigModel = require('../../models/autoRecordConfig');
const config = require('../../config/config');
const lightweightChecker = require('../../services/lightweightChecker');

// Cache to store user status data to avoid refetching
const userStatusCache = new Map();

/**
 * Handler for the /list command
 */
async function handler(ctx) {
  const chatId = ctx.message.chat.id;
  const userId = ctx.message.from.id;
  const monitoredUsers = monitoredUsersModel.getAllMonitoredUsers();
  const subbedUsers = monitoredUsers.filter(u => u.chatId === chatId);

  if (subbedUsers.length === 0) {
    return ctx.reply("No streamers are being monitored in this chat.");
  }

  // Send initial message
  const loading = await ctx.reply("Getting streamer statuses... This may take a moment.");
  
  try {
    // Process users in small batches to check their current status
    const batchSize = 3;
    let updatedUsers = [];
    
    // Process users in small batches first to make command more responsive
    for (let i = 0; i < subbedUsers.length; i += batchSize) {
      const batch = subbedUsers.slice(i, i + batchSize);
      
      // Process batch in parallel
      const batchResults = await Promise.all(batch.map(async (user) => {
        try {
          // Check if we have cached data that's less than 5 minutes old
          const cachedData = userStatusCache.get(`${user.username.toLowerCase()}_${chatId}`);
          const now = Date.now();
          
          if (cachedData && (now - cachedData.timestamp < 5 * 60 * 1000)) {
            // Use cached data if it's recent
            return { ...user, ...cachedData.data };
          }
          
          console.log(`Checking status for ${user.username} in /list command...`);
          
          // Get fresh status data
          const status = await lightweightChecker.getCachedStatus(user.username, {
            includeGoal: true // Make sure we get goal information
          });
          
          console.log(`Status for ${user.username}: Live=${status.isLive}, Goal=${status.goal?.active ? 'Yes' : 'No'}, Progress=${status.goal?.progress}`);
          
          // Update cache
          userStatusCache.set(`${user.username.toLowerCase()}_${chatId}`, {
            timestamp: now,
            data: {
              isLive: status.isLive,
              hasGoal: status.goal?.active || false,
              goalProgress: status.goal?.progress || 0,
              goalText: status.goal?.text || '',
              goalTokenAmount: status.goal?.tokenAmount || 0,
              goalCompleted: status.goal?.completed || false,
              lastChecked: new Date().toISOString(),
              nextBroadcast: status.nextBroadcast || user.nextBroadcast
            }
          });
          
          return {
            ...user,
            isLive: status.isLive,
            hasGoal: status.goal?.active || false,
            goalProgress: status.goal?.progress || 0,
            goalText: status.goal?.text || '',
            goalTokenAmount: status.goal?.tokenAmount || 0,
            goalCompleted: status.goal?.completed || false,
            lastChecked: new Date().toISOString(),
            nextBroadcast: status.nextBroadcast || user.nextBroadcast
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
    
    // Create simplified first-level buttons with just usernames
    const inlineKeyboard = [];
    
    // Check if user is premium
    const isPremium = premiumUsersModel.isPremiumUser(userId);
    
    // Add a row for each username with enhanced information
    updatedUsers.forEach((user, index) => {
      // Format the button display with more information
      const statusIcon = user.isLive ? "🔴" : "⚫";
      let buttonText = `${user.username} (${user.isLive ? "LIVE" : "Offline"})`;
      
      // Add goal information if available
      if (user.isLive && user.hasGoal) {
        const goalEmoji = "🎯";
        const progressPercent = Math.floor(user.goalProgress || 0);
        buttonText = `${user.username} ${statusIcon} ${goalEmoji} ${progressPercent}%`;
        
        // Add tokens if available
        if (user.goalTokenAmount) {
          buttonText += ` (${user.goalTokenAmount}tk)`;
        }
      }
      
      inlineKeyboard.push([
        Markup.button.callback(buttonText, `listUserDetails:${user.username}:${chatId}`)
      ]);
    });
    
    // Add refresh button
    inlineKeyboard.push([Markup.button.callback('🔄 Refresh Status', `refreshList:${chatId}`)]);
    
    // Edit the initial message
    await ctx.telegram.editMessageText(
      chatId,
      loading.message_id,
      null,
      "Monitored Streamers:\n\nSelect a streamer to see details and actions:",
      {
        reply_markup: { inline_keyboard: inlineKeyboard }
      }
    );
    
  } catch (error) {
    console.error("Error getting streamer list:", error);
    await ctx.telegram.editMessageText(
      chatId,
      loading.message_id,
      null,
      "Error fetching streamer statuses. Please try again."
    );
  }
}

/**
 * Generate a visual progress bar
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
 * Handle showing user details with improved goal progress display
 */
async function handleUserDetails(ctx) {
  try {
    const username = ctx.match[1];
    const chatId = parseInt(ctx.match[2], 10);
    const userId = ctx.from.id;
    
    // Get user data from cache
    const cachedData = userStatusCache.get(`${username.toLowerCase()}_${chatId}`);
    
    if (!cachedData) {
      await ctx.answerCbQuery('No data found for this user. Try refreshing.', { show_alert: true });
      return;
    }
    
    const userData = cachedData.data;
    const isPremium = premiumUsersModel.isPremiumUser(userId);
    
    // Get auto-record config if premium
    let isAutoRecorded = false;
    if (isPremium) {
      const autoRecordConfig = autoRecordConfigModel.getUserAutoRecordConfig(userId);
      isAutoRecorded = autoRecordConfig?.usernames && 
        autoRecordConfig.usernames.some(u => u.toLowerCase() === username.toLowerCase());
    }
    
    // Format the user details
    let message = `Details for ${username}:\n\n`;
    
    // Status information
    const status = userData.isLive ? "🔴 LIVE" : "⚫ Offline";
    const lastChecked = new Date(userData.lastChecked).toLocaleString();
    
    message += `Status: ${status}\n`;
    message += `Last checked: ${lastChecked}\n\n`;
    
    // Goal information if live
    if (userData.isLive && userData.hasGoal) {
      // Make sure we're showing the actual progress percentage
      const progressPercentage = Math.floor(userData.goalProgress || 0);
      
      // Extract percentage from goal text if progress is not set
      if (progressPercentage === 0 && userData.goalText) {
        const percentRegex = /(\d+(?:\.\d+)?)%/;
        const percentMatch = userData.goalText.match(percentRegex);
        if (percentMatch && percentMatch[1]) {
          // Update the percentage for display
          userData.goalProgress = parseFloat(percentMatch[1]);
        }
      }
      
      // Get the updated percentage
      const displayPercentage = Math.floor(userData.goalProgress || 0); 
      const progressBar = generateProgressBar(displayPercentage);
      
      message += `Goal Progress: ${progressBar} ${displayPercentage}%\n`;
      
      // Add token amount if available
      if (userData.goalTokenAmount) {
        message += `Tokens: ${userData.goalTokenAmount}tk\n`;
      }
      
      // Sanitize goal text
      let safeGoalText = userData.goalText || '';
      if (safeGoalText.length > 100 || 
          safeGoalText.includes('function') || 
          safeGoalText.includes('var ') || 
          safeGoalText.includes('window.')) {
        safeGoalText = "Special Goal";
      }
      
      if (safeGoalText) {
        message += `Goal: ${safeGoalText}\n\n`;
      }
      
      if (userData.goalCompleted) {
        message += `Goal completed! 🎉\n\n`;
      }
    } else if (!userData.isLive && userData.nextBroadcast) {
      message += `Next broadcast: ${userData.nextBroadcast}\n\n`;
    }
    
    // Create action buttons
    const actionButtons = [];
    
    // Basic actions
    actionButtons.push([
      Markup.button.callback(`❌ Remove`, `removeUser:${username}:${chatId}`)
    ]);
    
    // Recording options (different durations)
    if (userData.isLive) {
      actionButtons.push([
        Markup.button.callback(`⚪ Record 30s`, `quickRecord:${username}:${chatId}:30s`),
        Markup.button.callback(`⚪ Record 5m`, `quickRecord:${username}:${chatId}:5m`)
      ]);
      
      // Premium users get additional recording options
      if (isPremium) {
        actionButtons.push([
          Markup.button.callback(`⚪ Record 10m`, `quickRecord:${username}:${chatId}:10m`),
          Markup.button.callback(`⚪ Record 30m`, `quickRecord:${username}:${chatId}:30m`)
        ]);
      }
    }
    
    // Premium actions
    if (isPremium) {
      const autoRecordText = isAutoRecorded ? 
        `🔴 Remove Goal Auto` : 
        `🎯 Add Goal Auto`;
      
      actionButtons.push([
        Markup.button.callback(autoRecordText, `toggleAutoRecord:${username}:${chatId}`)
      ]);
    }
    
    // Back button
    actionButtons.push([
      Markup.button.callback(`⬅️ Back to List`, `backToList:${chatId}`)
    ]);
    
    // Edit the message with details and action buttons
    await ctx.editMessageText(message, {
      reply_markup: { inline_keyboard: actionButtons }
    });
    
  } catch (error) {
    console.error("Error showing user details:", error);
    await ctx.answerCbQuery('Error showing user details. Please try again.', { show_alert: true });
  }
}

/**
 * Handle going back to the main list
 */
async function handleBackToList(ctx) {
  try {
    const chatId = parseInt(ctx.match[1], 10);
    const userId = ctx.from.id;
    
    // Get all monitored users for this chat
    const monitoredUsers = monitoredUsersModel.getAllMonitoredUsers();
    const subbedUsers = monitoredUsers.filter(u => u.chatId === chatId);
    
    if (subbedUsers.length === 0) {
      return ctx.editMessageText("No streamers are being monitored in this chat.");
    }
    
    // Create first-level buttons with just usernames
    const inlineKeyboard = [];
    
    // Add a row for each username with enhanced display info
    subbedUsers.forEach((user) => {
      // Use cached status if available
      const cachedData = userStatusCache.get(`${user.username.toLowerCase()}_${chatId}`);
      const userData = cachedData ? cachedData.data : user;
      
      // Format the button display with enhanced information
      const statusIcon = userData.isLive ? "🔴" : "⚫";
      let buttonText = `${user.username} (${userData.isLive ? "LIVE" : "Offline"})`;
      
      // Add goal information if available
      if (userData.isLive && userData.hasGoal) {
        const goalEmoji = "🎯";
        const progressPercent = Math.floor(userData.goalProgress || 0);
        buttonText = `${user.username} ${statusIcon} ${goalEmoji} ${progressPercent}%`;
        
        // Add tokens if available
        if (userData.goalTokenAmount) {
          buttonText += ` (${userData.goalTokenAmount}tk)`;
        }
      }
      
      inlineKeyboard.push([
        Markup.button.callback(buttonText, `listUserDetails:${user.username}:${chatId}`)
      ]);
    });
    
    // Add refresh button
    inlineKeyboard.push([Markup.button.callback('🔄 Refresh Status', `refreshList:${chatId}`)]);
    
    // Edit the message
    await ctx.editMessageText(
      "Monitored Streamers:\n\nSelect a streamer to see details and actions:",
      {
        reply_markup: { inline_keyboard: inlineKeyboard }
      }
    );
    
  } catch (error) {
    console.error("Error handling back to list:", error);
    await ctx.answerCbQuery('Error going back to list. Please try again.', { show_alert: true });
  }
}

/**
 * Action handler for the refresh button
 */
async function handleRefreshAction(ctx) {
  try {
    // Get the chat ID from the callback data
    const chatId = parseInt(ctx.match[1], 10);
    
    // Answer the callback query first
    await ctx.answerCbQuery('Refreshing streamer statuses...');
    
    // Edit the message to show loading
    await ctx.editMessageText(
      "Refreshing streamer statuses... This may take a moment."
    );
    
    // Get the user ID
    const userId = ctx.from.id;
    
    // Get all monitored users
    const monitoredUsers = monitoredUsersModel.getAllMonitoredUsers();
    const subbedUsers = monitoredUsers.filter(u => u.chatId === chatId);

    if (subbedUsers.length === 0) {
      return ctx.editMessageText("No streamers are being monitored in this chat.");
    }
    
    // Clear the cache for these users
    subbedUsers.forEach(user => {
      userStatusCache.delete(`${user.username.toLowerCase()}_${chatId}`);
    });
    
    // Process users in batches to check their current status
    const batchSize = 3;
    let updatedUsers = [];
    
    // Process users in small batches
    for (let i = 0; i < subbedUsers.length; i += batchSize) {
      const batch = subbedUsers.slice(i, i + batchSize);
      
      // Process batch in parallel
      const batchResults = await Promise.all(batch.map(async (user) => {
        try {
          console.log(`Checking status for ${user.username} in refresh action...`);
          
          // Get fresh status
          const status = await lightweightChecker.getCachedStatus(user.username, {
            includeGoal: true,
            forceRefresh: true  // Force refresh when user requests it
          });
          
          console.log(`Status for ${user.username}: Live=${status.isLive}, Goal=${status.goal?.active ? 'Yes' : 'No'}, Progress=${status.goal?.progress}`);
          
          // Update cache
          userStatusCache.set(`${user.username.toLowerCase()}_${chatId}`, {
            timestamp: Date.now(),
            data: {
              isLive: status.isLive,
              hasGoal: status.goal?.active || false,
              goalProgress: status.goal?.progress || 0,
              goalText: status.goal?.text || '',
              goalTokenAmount: status.goal?.tokenAmount || 0,
              goalCompleted: status.goal?.completed || false,
              lastChecked: new Date().toISOString(),
              nextBroadcast: status.nextBroadcast || user.nextBroadcast
            }
          });
          
          return {
            ...user,
            isLive: status.isLive,
            hasGoal: status.goal?.active || false,
            goalProgress: status.goal?.progress || 0,
            goalText: status.goal?.text || '',
            goalTokenAmount: status.goal?.tokenAmount || 0,
            goalCompleted: status.goal?.completed || false,
            lastChecked: new Date().toISOString(),
            nextBroadcast: status.nextBroadcast || user.nextBroadcast
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
    
    // Create first-level buttons with enhanced information display
    const inlineKeyboard = [];
    
    // Add a row for each username with enhanced display
    updatedUsers.forEach((user) => {
      // Format the button display with enhanced information
      const statusIcon = user.isLive ? "🔴" : "⚫";
      let buttonText = `${user.username} (${user.isLive ? "LIVE" : "Offline"})`;
      
      // Add goal information if available
      if (user.isLive && user.hasGoal) {
        const goalEmoji = "🎯";
        const progressPercent = Math.floor(user.goalProgress || 0);
        buttonText = `${user.username} ${statusIcon} ${goalEmoji} ${progressPercent}%`;
        
        // Add tokens if available
        if (user.goalTokenAmount) {
          buttonText += ` (${user.goalTokenAmount}tk)`;
        }
      }
      
      inlineKeyboard.push([
        Markup.button.callback(buttonText, `listUserDetails:${user.username}:${chatId}`)
      ]);
    });
    
    // Add refresh button
    inlineKeyboard.push([Markup.button.callback('🔄 Refresh Status', `refreshList:${chatId}`)]);
    
    // Edit the message
    await ctx.editMessageText(
      "Monitored Streamers:\n\nSelect a streamer to see details and actions:",
      {
        reply_markup: { inline_keyboard: inlineKeyboard }
      }
    );
    
  } catch (error) {
    console.error("Error in handleRefreshAction:", error);
    try {
      await ctx.answerCbQuery('An error occurred. Please try again.', { show_alert: true });
      await ctx.editMessageText("Error refreshing streamer statuses. Please try again.");
    } catch (e) {
      console.error("Error sending error message:", e);
    }
  }
}

/**
 * Action handler for quick record button that triggers normal record flow
 * NOTE: This function is moved to commandHandler.js for direct implementation
 */
async function handleQuickRecordAction(ctx) {
  try {
    const username = ctx.match[1];
    const chatId = parseInt(ctx.match[2], 10);
    const duration = ctx.match[3] || "30s"; // Get duration from pattern match
    
    // This is just a stub - the actual implementation is now in commandHandler.js
    console.log(`Quick record action triggered for ${username} (${duration}) - stub only`);
    
    await ctx.answerCbQuery(`This button should be handled by commandHandler.js now`);
  } catch (error) {
    console.error("Error in handleQuickRecordAction:", error);
  }
}

/**
 * Action handler for toggling auto-record for a user
 */
async function handleToggleAutoRecordAction(ctx) {
  try {
    const username = ctx.match[1];
    const chatId = parseInt(ctx.match[2], 10);
    const userId = ctx.from.id;
    
    // Check if user has premium
    if (!premiumUsersModel.isPremiumUser(userId)) {
      return ctx.answerCbQuery(
        "Auto recording is a premium feature. Use /premium to upgrade.",
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
    
    // Return to user details with updated information
    setTimeout(() => {
      handleUserDetails(ctx);
    }, 500);
    
  } catch (error) {
    console.error("Error in handleToggleAutoRecordAction:", error);
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
      pattern: /^listUserDetails:(.+):(-?\d+)$/,
      handler: handleUserDetails
    },
    {
      pattern: /^backToList:(-?\d+)$/,
      handler: handleBackToList
    },
    {
      pattern: /^refreshList:(-?\d+)$/,
      handler: handleRefreshAction
    },
    {
      // This pattern still exists for completeness, but the actual implementation
      // is moved to commandHandler.js for better error handling
      pattern: /^quickRecord:(.+):(-?\d+):(.+)$/,
      handler: handleQuickRecordAction
    },
    {
      pattern: /^toggleAutoRecord:(.+):(-?\d+)$/,
      handler: handleToggleAutoRecordAction
    }
  ]
};