/**
 * Extend Command Handler
 * Extends an active recording
 */
const { Markup } = require('telegraf');
const memoryService = require('../../services/memoryService');
const premiumUsersModel = require('../../models/premiumUsers');
const config = require('../../config/config');

/**
 * /extend - Extend an active recording
 */
async function handler(ctx) {
  const userId = ctx.message.from.id;
  const chatId = ctx.message.chat.id;
  const args = ctx.message.text.split(' ').slice(1);
  
  // Check if user has active recordings
  const activeRecordings = Array.from(memoryService.activeRecordings.entries())
    .filter(([key, recording]) => {
      return recording.chatId === chatId && recording.userId === userId;
    });
  
  if (activeRecordings.length === 0) {
    return ctx.reply("⚠️ You don't have any active recordings to extend.");
  }
  
  // Check if extending is allowed for this user
  const isPremium = premiumUsersModel.isPremiumUser(userId);
  
  if (!isPremium) {
    return ctx.reply(
      "⭐ *Premium Feature*\n\n" +
      "Extending recordings is a premium feature. Upgrade to premium to use this feature!\n\n" +
      "Type /premium for more information.",
      { parse_mode: 'Markdown' }
    );
  }
  
  // If no arguments, show the list of active recordings to extend
  if (args.length === 0) {
    // Create buttons for each active recording
    const buttons = activeRecordings.map(([key, recording]) => {
      const username = key.split('_')[2]; // Extract username from key
      const timeElapsed = Math.floor((Date.now() - recording.startTime) / 1000);
      const timeRemaining = Math.max(0, recording.duration - timeElapsed);
      
      return [Markup.button.callback(
        `${username} - ${timeRemaining}s remaining`,
        `extend_select:${key}`
      )];
    });
    
    // Add cancel button
    buttons.push([Markup.button.callback('❌ Cancel', 'extend_cancel')]);
    
    return ctx.reply(
      "🎬 *Extend Recording*\n\n" +
      "Select a recording to extend, then specify the additional seconds:\n",
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons)
      }
    );
  }
  
  // If one recording and seconds provided
  if (activeRecordings.length === 1 && args.length === 1) {
    const seconds = parseInt(args[0], 10);
    const [key, recording] = activeRecordings[0];
    
    return handleExtension(ctx, key, seconds);
  }
  
  // If multiple arguments, assume first is username and second is seconds
  if (args.length >= 2) {
    const usernameToExtend = args[0].toLowerCase();
    const seconds = parseInt(args[1], 10);
    
    // Find the recording for this username
    const matchingRecording = activeRecordings.find(([key, recording]) => {
      const keyUsername = key.split('_')[2]; // Extract username from key
      return keyUsername && keyUsername.toLowerCase() === usernameToExtend;
    });
    
    if (!matchingRecording) {
      return ctx.reply(`⚠️ No active recording found for ${args[0]}. Use /extend to see active recordings.`);
    }
    
    const [key, recording] = matchingRecording;
    return handleExtension(ctx, key, seconds);
  }
  
  // Otherwise, show usage
  return ctx.reply(
    "⚠️ Usage: /extend seconds\nOr: /extend username seconds\n\nExample: /extend 60\nExample: /extend AlicePlayss 120"
  );
}

/**
 * Handle the extension of a recording
 */
async function handleExtension(ctx, recordingKey, additionalSeconds) {
  const recording = memoryService.activeRecordings.get(recordingKey);
  
  if (!recording) {
    return ctx.reply("⚠️ This recording is no longer active.");
  }
  
  // Validate the seconds
  if (isNaN(additionalSeconds) || additionalSeconds <= 0) {
    return ctx.reply("⚠️ Please provide a valid positive number of seconds to extend.");
  }
  
  // Check maximum duration
  const newTotalDuration = recording.duration + additionalSeconds;
  const maxDuration = config.PREMIUM_USER_MAX_DURATION || 1200; // 20 minutes default
  
  if (newTotalDuration > maxDuration) {
    return ctx.reply(`⚠️ Cannot extend. Maximum recording duration is ${maxDuration} seconds (${maxDuration/60} minutes).`);
  }
  
  // Update the recording duration
  recording.duration = newTotalDuration;
  memoryService.activeRecordings.set(recordingKey, recording);
  
  // Calculate remaining time
  const timeElapsed = Math.floor((Date.now() - recording.startTime) / 1000);
  const timeRemaining = Math.max(0, newTotalDuration - timeElapsed);
  
  // Extract username from key
  const username = recordingKey.split('_')[2];
  
  return ctx.reply(
    `✅ Successfully extended recording of ${username}.\n\n` +
    `New duration: ${newTotalDuration} seconds\n` +
    `Time remaining: ~${timeRemaining} seconds`
  );
}

module.exports = {
  handler,
  // Export callback handlers
  actions: [
    {
      pattern: /^extend_select:(.+)$/,
      handler: async (ctx) => {
        const recordingKey = ctx.match[1];
        await ctx.answerCbQuery();
        
        // Edit message to ask for seconds
        await ctx.editMessageText(
          "🎬 *Extend Recording*\n\n" +
          "How many seconds would you like to add?\n\n" +
          "Type a number or select a preset:",
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  Markup.button.callback('30 seconds', `extend_time:${recordingKey}:30`),
                  Markup.button.callback('60 seconds', `extend_time:${recordingKey}:60`)
                ],
                [
                  Markup.button.callback('2 minutes', `extend_time:${recordingKey}:120`),
                  Markup.button.callback('5 minutes', `extend_time:${recordingKey}:300`)
                ],
                [Markup.button.callback('❌ Cancel', 'extend_cancel')]
              ]
            }
          }
        );
        
        // Store the recording key for potential text response
        ctx.session = ctx.session || {};
        ctx.session.extendRecordingKey = recordingKey;
      }
    },
    {
      pattern: /^extend_time:(.+):(\d+)$/,
      handler: async (ctx) => {
        const recordingKey = ctx.match[1];
        const seconds = parseInt(ctx.match[2], 10);
        
        await ctx.answerCbQuery(`Extending by ${seconds} seconds...`);
        
        // Delete the selection message
        try {
          await ctx.deleteMessage();
        } catch (e) {
          console.error("Could not delete message:", e);
        }
        
        // Handle the extension
        return handleExtension(ctx, recordingKey, seconds);
      }
    },
    {
      pattern: /^extend_cancel$/,
      handler: async (ctx) => {
        await ctx.answerCbQuery("Cancelled");
        
        // Delete the selection message
        try {
          await ctx.deleteMessage();
        } catch (e) {
          console.error("Could not delete message:", e);
        }
        
        await ctx.reply("❌ Extension cancelled.");
      }
    }
  ]
};