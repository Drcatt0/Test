/**
 * Command Handler
 */
const fs = require('fs');
const path = require('path');
const { Markup } = require('telegraf');

const commandsPath = path.join(__dirname, 'commands');

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
    
    // Register the command handler
    bot.command(commandName, command.handler);
    
    // Register any action handlers for this command
    if (command.actions && Array.isArray(command.actions)) {
      command.actions.forEach(action => {
        if (action.pattern && action.handler) {
          bot.action(action.pattern, action.handler);
        }
      });
    }
    
    console.log(`Registered command: ${commandName}`);
  }
  
  console.log('All commands registered');
  
  // Handle inline button callbacks for removing users
  bot.action(/^removeUser:(.+):(-?\d+)$/, async (ctx) => {
    const username = ctx.match[1];
    const chatId = parseInt(ctx.match[2], 10);
    
    // Delegate to remove command handler
    const removeCommand = require(path.join(commandsPath, 'removeCommand'));
    await removeCommand.handleRemoveAction(ctx, username, chatId);
  });
}

module.exports = {
  registerCommands
};
