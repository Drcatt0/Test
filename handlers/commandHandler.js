/**
 * Command Handler
 */
const fs = require('fs');
const path = require('path');
const { Markup } = require('telegraf');

const commandsPath = path.join(__dirname, 'commands');

/**
 * Process a command without blocking the event loop
 */
async function processCommandNonBlocking(ctx, handler) {
  try {
    // Track that the bot is processing a message
    ctx.telegram.sendChatAction(ctx.chat.id, 'typing').catch(e => {});
    
    // Run the handler without awaiting it, so it doesn't block
    handler(ctx).catch(error => {
      console.error(`Error in command handler:`, error);
      try {
        ctx.reply('⚠️ Something went wrong while processing your command. Please try again.')
          .catch(e => {});
      } catch (e) {}
    });
    
    // Return immediately to handle other commands
    return true;
  } catch (error) {
    console.error(`Error setting up non-blocking command:`, error);
    return false;
  }
}

/**
 * Register all command handlers
 */
function registerCommands(bot) {
  // Read all command files from the commands directory
  const commandFiles = fs.readdirSync(commandsPath)
    .filter(file => file.endsWith('.js'));
  
  // Register each command
  for (const file of commandFiles) {
    const commandName = file.split('.')[0].replace('Command', '');
    const command = require(path.join(commandsPath, file));
    
    // Register the command handler with non-blocking processing
    bot.command(commandName, (ctx) => {
      return processCommandNonBlocking(ctx, command.handler);
    });
    
    // Register any action handlers for this command
    if (command.actions && Array.isArray(command.actions)) {
      command.actions.forEach(action => {
        if (action.pattern && action.handler) {
          // Register the action with non-blocking processing
          bot.action(action.pattern, (ctx) => {
            // Answer the callback query immediately
            ctx.answerCbQuery().catch(e => {});
            
            // Process the action handler without blocking
            return processCommandNonBlocking(ctx, action.handler);
          });
        }
      });
    }
    
    console.log(`Registered command: ${commandName}`);
  }
  
  console.log('All commands registered');
  
  // Handle inline button callbacks for removing users
  bot.action(/^removeUser:(.+):(-?\d+)$/, async (ctx) => {
    // Answer the callback query immediately
    ctx.answerCbQuery().catch(e => {});
    
    const username = ctx.match[1];
    const chatId = parseInt(ctx.match[2], 10);
    
    // Delegate to remove command handler in non-blocking way
    const removeCommand = require(path.join(commandsPath, 'removeCommand'));
    processCommandNonBlocking(ctx, (c) => removeCommand.handleRemoveAction(c, username, chatId));
  });
  
  // For quick recording
  bot.action(/^quickRecord:(.+):(-?\d+)$/, async (ctx) => {
    // Answer the callback query immediately
    ctx.answerCbQuery(`Starting recording of ${ctx.match[1]}...`).catch(e => {});
    
    const listCommand = require(path.join(commandsPath, 'listCommand'));
    if (listCommand.actions) {
      const action = listCommand.actions.find(a => a.pattern.toString().includes('quickRecord'));
      if (action && action.handler) {
        processCommandNonBlocking(ctx, action.handler);
      }
    }
  });
  
  // For toggling auto-record for a user
  bot.action(/^toggleAutoRecord:(.+):(-?\d+)$/, async (ctx) => {
    // Answer the callback query immediately
    ctx.answerCbQuery().catch(e => {});
    
    const listCommand = require(path.join(commandsPath, 'listCommand'));
    if (listCommand.actions) {
      const action = listCommand.actions.find(a => a.pattern.toString().includes('toggleAutoRecord:'));
      if (action && action.handler) {
        processCommandNonBlocking(ctx, action.handler);
      }
    }
  });
  
  // For toggling auto-record status
  bot.action(/^toggleAutoRecordStatus:(-?\d+)$/, async (ctx) => {
    // Answer the callback query immediately
    ctx.answerCbQuery().catch(e => {});
    
    const listCommand = require(path.join(commandsPath, 'listCommand'));
    if (listCommand.actions) {
      const action = listCommand.actions.find(a => a.pattern.toString().includes('toggleAutoRecordStatus'));
      if (action && action.handler) {
        processCommandNonBlocking(ctx, action.handler);
      }
    }
  });
}

module.exports = {
  registerCommands
};