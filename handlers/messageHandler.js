/**
 * Enhanced Message Handler for non-command text messages
 */
const path = require('path');
const adminCommands = require('./commands/adminCommands');
const commandsPath = path.join(__dirname, 'commands');

/**
 * Process a message in a non-blocking way
 */
function processMessageNonBlocking(ctx, bot, handlerFunction) {
  try {
    // Show typing indicator
    ctx.telegram.sendChatAction(ctx.chat.id, 'typing').catch(e => {});
    
    // Process without awaiting the result
    handlerFunction(ctx, bot).catch(error => {
      console.error('Error processing message:', error);
    });
    
    return true;
  } catch (error) {
    console.error('Error in non-blocking message handler:', error);
    return false;
  }
}

/**
 * Register message handler
 */
function registerHandler(bot) {
  bot.on('text', (ctx) => {
    const text = ctx.message.text.toLowerCase();
    
    // Check if it's a command without slash
    const commandPatterns = [
      { pattern: /^record\s+(\S+)\s+(\d+)$/i, command: 'record' },
      { pattern: /^add\s+(\S+)$/i, command: 'add' },
      { pattern: /^remove\s+(\S+)$/i, command: 'remove' },
      { pattern: /^list$/i, command: 'list' },
      { pattern: /^info\s+(\S+)$/i, command: 'info' },
      { pattern: /^popular$/i, command: 'popular' },
      { pattern: /^search\s+(\S+)$/i, command: 'search' },
      { pattern: /^premium$/i, command: 'premium' },
      { pattern: /^goalrecord\s+(.+)$/i, command: 'goalrecord' },
      { pattern: /^goalrecord$/i, command: 'goalrecord' },
      { pattern: /^extend\s+(\d+)$/i, command: 'extend' },
      { pattern: /^extend\s+(\S+)\s+(\d+)$/i, command: 'extend' },
      { pattern: /^progress$/i, command: 'progress' },
      { pattern: /^help$/i, command: 'help' }
    ];
    
    // Check each pattern
    for (const { pattern, command } of commandPatterns) {
      const match = text.match(pattern);
      
      if (match) {
        // Check if command is disabled
        if (adminCommands.isCommandDisabled(command)) {
          ctx.reply(`⚠️ The command /${command} is currently disabled by the administrator.`);
          return;
        }
        
        return processMessageNonBlocking(ctx, bot, async (ctx, bot) => {
          // Reconstruct the command with proper format
          let commandText = `/${command}`;
          
          // Add parameters if present
          if (match.length > 1) {
            for (let i = 1; i < match.length; i++) {
              if (match[i]) commandText += ` ${match[i]}`;
            }
          }
          
          // Modify the message to contain the command
          ctx.message.text = commandText;
          
          // Execute the command as if it was sent with a slash
          return bot.handleUpdate({
            ...ctx.update,
            message: ctx.message
          });
        });
      }
    }
    
    // Handle message patterns like "record username 30"
    if (text.startsWith('record ') || text.includes('/record ')) {
      return processMessageNonBlocking(ctx, bot, async (ctx, bot) => {
        const parts = text.replace('/record', 'record').split(' ').filter(Boolean);
        if (parts.length >= 3) {
          const username = parts[1];
          const duration = parseInt(parts[2], 10);
          
          if (!isNaN(duration)) {
            // Call the record command with the parameters
            ctx.message.text = `/record ${username} ${duration}`;
            return bot.handleUpdate({
              ...ctx.update,
              message: ctx.message
            });
          }
        }
      });
    }
    
    // Handle responses to extend command
    if (ctx.session && ctx.session.extendRecordingKey && /^\d+$/.test(text)) {
      return processMessageNonBlocking(ctx, bot, async (ctx, bot) => {
        const recordingKey = ctx.session.extendRecordingKey;
        const seconds = parseInt(text, 10);
        
        // Create a fake callback query context
        const fakeCtx = {
          ...ctx,
          match: [null, recordingKey, seconds],
          answerCbQuery: () => Promise.resolve(),
          deleteMessage: () => Promise.resolve()
        };
        
        // Call the extend handler
        const extendCommand = require('./commands/extendCommand');
        if (extendCommand.actions) {
          const action = extendCommand.actions.find(a => a.pattern.toString().includes('extend_time:'));
          if (action && action.handler) {
            // Clear the session
            delete ctx.session.extendRecordingKey;
            
            // Handle the extension
            return action.handler(fakeCtx);
          }
        }
      });
    }
    
    // Handle category selection for search command
    if (/^\/(teen|milf|bbw|asian|latina|ebony|blonde|brunette|redhead|tattoo|piercing|curvy|petite|mature|couple|bigboobs|smallboobs|hairy|shaved|squirt|anal|bigass|feet|smoking|pregnant|new)$/i.test(text)) {
      return processMessageNonBlocking(ctx, bot, async (ctx, bot) => {
        const category = text.substring(1).toLowerCase();
        
        // Call the search command with the category
        ctx.message.text = `/search ${category}`;
        return bot.handleUpdate({
          ...ctx.update,
          message: ctx.message
        });
      });
    }
  });
  
  // Handle photo uploads for admin profile command
  bot.on('photo', (ctx) => {
    // Only process if it's a reply to the profile command
    if (ctx.message.reply_to_message && 
        ctx.message.reply_to_message.text && 
        ctx.message.reply_to_message.text.startsWith('/profile')) {
      
      return processMessageNonBlocking(ctx, bot, async (ctx, bot) => {
        // Check if user is admin
        if (!adminCommands.isAdmin(ctx)) {
          return ctx.reply("⚠️ This command is only available to the bot administrator.");
        }
        
        // Call the profile handler
        const profileCommand = require('./commands/adminCommands');
        return profileCommand.profileHandler(ctx);
      });
    }
  });
  
  console.log('Enhanced message handler registered');
}

module.exports = {
  registerHandler
};