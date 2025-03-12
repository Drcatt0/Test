// In handlers/commands/listCommand.js

const { Markup } = require('telegraf');
const monitorService = require('../../services/monitorService');
const monitoredUsersModel = require('../../models/monitoredUsers');

/**
 * Handler for the /list command
 */
async function handler(ctx) {
  const chatId = ctx.message.chat.id;
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
      
      // Add remove button
      inlineKeyboard.push([
        Markup.button.callback(`🗑️ Remove ${user.username}`, `removeUser:${user.username}:${chatId}`)
      ]);
    });
    
    // Add refresh button
    inlineKeyboard.push([
      Markup.button.callback('🔄 Refresh Statuses', `refreshList:${chatId}`)
    ]);
    
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
    message: { chat: { id: chatId } },
    telegram: ctx.telegram,
    reply: ctx.telegram.sendMessage.bind(ctx.telegram, chatId)
  });
  
  // Answer the callback query
  await ctx.answerCbQuery('Refreshed streamer statuses');
}

module.exports = {
  handler,
  actions: [
    {
      pattern: /^refreshList:(-?\d+)$/,
      handler: handleRefreshAction
    }
  ]
};
module.exports = { handler };