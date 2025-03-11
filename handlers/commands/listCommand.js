const { Markup } = require('telegraf');
const monitorService = require('../../services/monitorService');

/**
 * Handler for the /list command
 */
async function handler(ctx, monitoredUsers) {
  const chatId = ctx.message.chat.id;
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
          const currentStatus = await monitorService.checkStripchatStatus(user.username);
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
        const progressBar = monitorService.generateProgressBar(goal.progress);
        const progressPercentage = Math.floor(goal.progress);
        
        message += `   ${progressBar} ${progressPercentage}%\n`;
        
        if (goal.text) {
          message += `   🎯 *Goal:* ${goal.text}\n`;
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

module.exports = { handler };