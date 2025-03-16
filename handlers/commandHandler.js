/**
 * Enhanced Command Handler
 */
const fs = require('fs');
const path = require('path');
const { Markup } = require('telegraf');
const adminCommands = require('./commands/adminCommands');

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
  
  // Register admin commands
  bot.command('disable', (ctx) => {
    return processCommandNonBlocking(ctx, adminCommands.disableHandler);
  });
  
  bot.command('revoke', (ctx) => {
    return processCommandNonBlocking(ctx, adminCommands.revokeHandler);
  });
  
  bot.command('gen', (ctx) => {
    return processCommandNonBlocking(ctx, adminCommands.genHandler);
  });
  
  bot.command('profile', (ctx) => {
    return processCommandNonBlocking(ctx, adminCommands.profileHandler);
  });
  
  console.log('Admin commands registered');
  
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
  
  // Explicit handler for quick recording - FIXED IMPLEMENTATION
  bot.action(/^quickRecord:(.+):(-?\d+):(.+)$/, async (ctx) => {
    // Answer the callback query immediately
    console.log(`Quick Record button clicked for ${ctx.match[1]} (${ctx.match[3]})`);
    ctx.answerCbQuery(`Starting recording of ${ctx.match[1]} for ${ctx.match[3]}...`).catch(e => {
      console.error("Error answering callback query:", e);
    });
    
    try {
      const username = ctx.match[1];
      const chatId = parseInt(ctx.match[2], 10);
      const duration = ctx.match[3]; // Duration parameter (e.g., "30s", "5m")
      
      // Create and send a /record command directly
      const recordMessage = `/record ${username} ${duration}`;
      console.log(`Sending record command: ${recordMessage}`);
      
      await ctx.telegram.sendMessage(chatId, recordMessage);
      console.log(`Record command sent successfully`);
    } catch (error) {
      console.error("Error processing quick record:", error);
      try {
        await ctx.reply("Error processing recording request. Please try again or use the /record command directly.");
      } catch (e) {
        console.error("Error sending error message:", e);
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
  
  // Handle popular/search actions
  bot.action(/^getInfo:(.+)$/, async (ctx) => {
    ctx.answerCbQuery(`Getting info for ${ctx.match[1]}...`).catch(e => {});
    
    const infoCommand = require(path.join(commandsPath, 'infoCommand'));
    ctx.message = { text: `/info ${ctx.match[1]}`, chat: ctx.chat, from: ctx.from };
    processCommandNonBlocking(ctx, infoCommand.handler);
  });
  
  bot.action(/^watchStream:(.+)$/, async (ctx) => {
    ctx.answerCbQuery(`Opening ${ctx.match[1]}'s stream...`).catch(e => {});
    
    ctx.reply(
      `🔴 Watch *${ctx.match[1]}* live stream:\n` +
      `[Click here to watch](https://stripchat.com/${ctx.match[1]})`,
      { parse_mode: 'Markdown' }
    );
  });
  
  bot.action(/^addUser:(.+)$/, async (ctx) => {
    ctx.answerCbQuery(`Adding ${ctx.match[1]} to your monitors...`).catch(e => {});
    
    const addCommand = require(path.join(commandsPath, 'addCommand'));
    ctx.message = { text: `/add ${ctx.match[1]}`, chat: ctx.chat, from: ctx.from };
    processCommandNonBlocking(ctx, addCommand.handler);
  });
  
  // Handle search actions
  bot.action(/^searchInfo:(.+)$/, async (ctx) => {
    ctx.answerCbQuery(`Getting info for ${ctx.match[1]}...`).catch(e => {});
    
    const infoCommand = require(path.join(commandsPath, 'infoCommand'));
    ctx.message = { text: `/info ${ctx.match[1]}`, chat: ctx.chat, from: ctx.from };
    processCommandNonBlocking(ctx, infoCommand.handler);
  });
  
  bot.action(/^searchAdd:(.+)$/, async (ctx) => {
    ctx.answerCbQuery(`Adding ${ctx.match[1]} to your monitors...`).catch(e => {});
    
    const addCommand = require(path.join(commandsPath, 'addCommand'));
    ctx.message = { text: `/add ${ctx.match[1]}`, chat: ctx.chat, from: ctx.from };
    processCommandNonBlocking(ctx, addCommand.handler);
  });
  
  // Handle start command agreement
  bot.action(/^agree_terms:(\d+)$/, async (ctx) => {
    ctx.answerCbQuery("Welcome! Let's get started.").catch(e => {});
    
    const startCommand = require(path.join(commandsPath, 'startCommand'));
    if (startCommand.actions) {
      const action = startCommand.actions.find(a => a.pattern.toString().includes('agree_terms:'));
      if (action && action.handler) {
        processCommandNonBlocking(ctx, action.handler);
      }
    }
  });
  
  bot.action(/^decline_terms:(\d+)$/, async (ctx) => {
    ctx.answerCbQuery("You have declined the terms.").catch(e => {});
    
    const startCommand = require(path.join(commandsPath, 'startCommand'));
    if (startCommand.actions) {
      const action = startCommand.actions.find(a => a.pattern.toString().includes('decline_terms:'));
      if (action && action.handler) {
        processCommandNonBlocking(ctx, action.handler);
      }
    }
  });
  
  // Handle extend recording actions
  bot.action(/^extend_select:(.+)$/, async (ctx) => {
    ctx.answerCbQuery().catch(e => {});
    
    const extendCommand = require(path.join(commandsPath, 'extendCommand'));
    if (extendCommand.actions) {
      const action = extendCommand.actions.find(a => a.pattern.toString().includes('extend_select:'));
      if (action && action.handler) {
        processCommandNonBlocking(ctx, action.handler);
      }
    }
  });
  
  bot.action(/^extend_time:(.+):(\d+)$/, async (ctx) => {
    ctx.answerCbQuery(`Extending by ${ctx.match[2]} seconds...`).catch(e => {});
    
    const extendCommand = require(path.join(commandsPath, 'extendCommand'));
    if (extendCommand.actions) {
      const action = extendCommand.actions.find(a => a.pattern.toString().includes('extend_time:'));
      if (action && action.handler) {
        processCommandNonBlocking(ctx, action.handler);
      }
    }
  });
  
  bot.action(/^extend_cancel$/, async (ctx) => {
    ctx.answerCbQuery("Cancelled").catch(e => {});
    
    const extendCommand = require(path.join(commandsPath, 'extendCommand'));
    if (extendCommand.actions) {
      const action = extendCommand.actions.find(a => a.pattern.toString().includes('extend_cancel'));
      if (action && action.handler) {
        processCommandNonBlocking(ctx, action.handler);
      }
    }
  });
}

module.exports = {
  registerCommands
};