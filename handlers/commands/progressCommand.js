/**
 * Progress Command Handler
 * Shows progress of active recordings
 */
const memoryService = require('../../services/memoryService');

/**
 * /progress - Check progress of active recordings
 */
async function handler(ctx) {
  const userId = ctx.message.from.id;
  const chatId = ctx.message.chat.id;
  
  // Check if user has active recordings
  const activeRecordings = Array.from(memoryService.activeRecordings.entries())
    .filter(([key, recording]) => {
      return recording.chatId === chatId && recording.userId === userId;
    });
  
  // Also check auto recordings
  const activeAutoRecordings = Array.from(memoryService.activeAutoRecordings)
    .filter(key => key.includes(`${chatId}_`))
    .map(key => {
      // Extract username from key
      const keyParts = key.split('_');
      return keyParts[keyParts.length - 1]; // Last part should be username
    });
  
  if (activeRecordings.length === 0 && activeAutoRecordings.length === 0) {
    return ctx.reply("⚠️ You don't have any active recordings at the moment.");
  }
  
  let message = "🎬 *Active Recordings*\n\n";
  
  // Format manual recordings
  if (activeRecordings.length > 0) {
    message += "📝 *Manual Recordings:*\n";
    
    activeRecordings.forEach(([key, recording], index) => {
      // Extract username from key
      const username = key.split('_')[2];
      
      // Calculate progress
      const now = Date.now();
      const timeElapsed = Math.floor((now - recording.startTime) / 1000);
      const progress = Math.min(100, Math.floor((timeElapsed / recording.duration) * 100));
      const timeRemaining = Math.max(0, recording.duration - timeElapsed);
      
      // Create progress bar
      const progressBar = generateProgressBar(progress);
      
      // Add to message
      message += `${index + 1}. *${username}*\n`;
      message += `   ${progressBar} ${progress}%\n`;
      message += `   ⏱️ ${timeElapsed}s elapsed / ${recording.duration}s total\n`;
      message += `   ⏳ ~${timeRemaining}s remaining\n`;
      
      if (recording.isPremium) {
        message += `   ✨ Premium recording\n`;
      }
      
      message += '\n';
    });
  }
  
  // Format auto recordings
  if (activeAutoRecordings.length > 0) {
    message += "🔄 *Auto Goal Recordings:*\n";
    
    activeAutoRecordings.forEach((username, index) => {
      message += `${index + 1}. *${username}* - Recording in progress\n`;
    });
    
    message += '\n';
  }
  
  // Add note about extending
  message += "ℹ️ Use /extend to add time to manual recordings.";
  
  return ctx.reply(message, { parse_mode: 'Markdown' });
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