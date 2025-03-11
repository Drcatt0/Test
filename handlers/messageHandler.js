/**
 * Message Handler for non-command text messages
 */
const path = require('path');
const commandsPath = path.join(__dirname, 'commands');

/**
 * Register message handler
 */
function registerHandler(bot) {
  bot.on('text', async (ctx) => {
    const text = ctx.message.text.toLowerCase();
    
    // Handle message patterns like "record username 30"
    if (text.startsWith('record ') || text.includes('/record ')) {
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
    }
    
    // Handle message patterns like "add username"
    if (text.startsWith('add ') || text.includes('/add ')) {
      const parts = text.replace('/add', 'add').split(' ').filter(Boolean);
      if (parts.length >= 2) {
        const username = parts[1];
        
        // Call the add command with the parameters
        ctx.message.text = `/add ${username}`;
        return bot.handleUpdate({
          ...ctx.update,
          message: ctx.message
        });
      }
    }
    
    // Handle message patterns like "remove username"
    if (text.startsWith('remove ') || text.includes('/remove ')) {
      const parts = text.replace('/remove', 'remove').split(' ').filter(Boolean);
      if (parts.length >= 2) {
        const username = parts[1];
        
        // Call the remove command with the parameters
        ctx.message.text = `/remove ${username}`;
        return bot.handleUpdate({
          ...ctx.update,
          message: ctx.message
        });
      }
    }
    
    // Handle "list" command without slash
    if (text === 'list' || text === 'list streamers') {
      ctx.message.text = '/list';
      return bot.handleUpdate({
        ...ctx.update,
        message: ctx.message
      });
    }
    
    // Handle autorecord commands
    if (text.startsWith('autorecord') || text.includes('/autorecord')) {
      const parts = text.replace('/autorecord', 'autorecord').split(' ').filter(Boolean);
      if (parts.length >= 1) {
        let commandText = '/autorecord';
        if (parts.length > 1) {
          commandText += ' ' + parts.slice(1).join(' ');
        }
        
        ctx.message.text = commandText;
        return bot.handleUpdate({
          ...ctx.update,
          message: ctx.message
        });
      }
    }
  });
  
  console.log('Message handler registered');
}

module.exports = {
  registerHandler
};
