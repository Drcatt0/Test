/**
 * Admin Commands Handler
 * Special commands for bot owner/admin (@drcatto)
 */
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const { Markup } = require('telegraf');
const premiumUsersModel = require('../../models/premiumUsers');
const config = require('../../config/config');

// Admin username (for validation)
const ADMIN_USERNAME = 'drcatto';

// Store disabled commands
let disabledCommands = [];

/**
 * Validate if user is admin
 */
function isAdmin(ctx) {
  return ctx.message && ctx.message.from && ctx.message.from.username && 
         ctx.message.from.username.toLowerCase() === ADMIN_USERNAME.toLowerCase();
}

/**
 * Check if a command is disabled
 */
function isCommandDisabled(command) {
  return disabledCommands.includes(command.toLowerCase());
}

/**
 * /disable - Disable a command (admin only)
 */
async function disableHandler(ctx) {
  if (!isAdmin(ctx)) {
    return ctx.reply("⚠️ This command is only available to the bot administrator.");
  }
  
  const args = ctx.message.text.split(' ').slice(1);
  
  if (args.length < 1) {
    return ctx.reply(
      "⚠️ Usage: /disable command\n\n" +
      "Example: /disable search\n\n" +
      "Currently disabled commands: " + 
      (disabledCommands.length > 0 ? disabledCommands.join(', ') : "None")
    );
  }
  
  const commandToDisable = args[0].toLowerCase().replace(/^\//, '');
  
  // Don't allow disabling admin commands or critical ones
  const protectedCommands = ['help', 'start', 'disable', 'revoke', 'gen', 'profile'];
  
  if (protectedCommands.includes(commandToDisable)) {
    return ctx.reply(`⚠️ Cannot disable protected command: ${commandToDisable}`);
  }
  
  // Add to disabled list if not already there
  if (!disabledCommands.includes(commandToDisable)) {
    disabledCommands.push(commandToDisable);
    await ctx.reply(`✅ Command /${commandToDisable} has been disabled.`);
  } else {
    // If already disabled, re-enable it
    disabledCommands = disabledCommands.filter(cmd => cmd !== commandToDisable);
    await ctx.reply(`✅ Command /${commandToDisable} has been re-enabled.`);
  }
  
  // Show current status
  return ctx.reply(
    "📝 Currently disabled commands: " + 
    (disabledCommands.length > 0 ? disabledCommands.join(', ') : "None")
  );
}

/**
 * /revoke - Revoke premium access (admin only)
 */
async function revokeHandler(ctx) {
  if (!isAdmin(ctx)) {
    return ctx.reply("⚠️ This command is only available to the bot administrator.");
  }
  
  const args = ctx.message.text.split(' ').slice(1);
  
  if (args.length < 1) {
    return ctx.reply(
      "⚠️ Usage: /revoke [user|key] identifier\n\n" +
      "Examples:\n" +
      "/revoke user 123456789\n" +
      "/revoke key ALPHA-TEST-KEY-2024"
    );
  }
  
  const revokeType = args[0].toLowerCase();
  const identifier = args[1];
  
  if (!identifier) {
    return ctx.reply("⚠️ Please specify the user ID or key to revoke.");
  }
  
  if (revokeType === 'user') {
    // Revoke premium from user
    const userId = identifier;
    const userDetails = premiumUsersModel.getPremiumUserDetails(userId);
    
    if (!userDetails) {
      return ctx.reply(`⚠️ User ${userId} is not a premium user.`);
    }
    
    // Get all premium users
    const premiumUsers = await premiumUsersModel.loadPremiumUsers();
    
    // Remove user from premium users
    delete premiumUsers[userId];
    await premiumUsersModel.savePremiumUsers();
    
    return ctx.reply(`✅ Premium access has been revoked for user ${userId}.`);
  } else if (revokeType === 'key') {
    // Revoke a premium key
    const key = identifier.toUpperCase();
    
    if (!config.PREMIUM_KEYS[key]) {
      return ctx.reply(`⚠️ Premium key ${key} not found.`);
    }
    
    // Mark the key as used
    config.PREMIUM_KEYS[key].used = true;
    
    // Find and revoke users with this key
    const usersToRevoke = [];
    const premiumUsers = await premiumUsersModel.loadPremiumUsers();
    
    for (const [userId, userData] of Object.entries(premiumUsers)) {
      if (userData.key === key) {
        usersToRevoke.push(userId);
        delete premiumUsers[userId];
      }
    }
    
    await premiumUsersModel.savePremiumUsers();
    
    return ctx.reply(
      `✅ Premium key ${key} has been revoked.\n` +
      `Revoked premium access from ${usersToRevoke.length} users.`
    );
  } else {
    return ctx.reply(
      "⚠️ Invalid revoke type. Use either 'user' or 'key'.\n\n" +
      "Examples:\n" +
      "/revoke user 123456789\n" +
      "/revoke key ALPHA-TEST-KEY-2024"
    );
  }
}

/**
 * /gen - Generate premium key (admin only)
 */
async function genHandler(ctx) {
  if (!isAdmin(ctx)) {
    return ctx.reply("⚠️ This command is only available to the bot administrator.");
  }
  
  const args = ctx.message.text.split(' ').slice(1);
  const keyCount = args.length > 0 ? parseInt(args[0], 10) : 1;
  
  if (isNaN(keyCount) || keyCount < 1 || keyCount > 10) {
    return ctx.reply("⚠️ Please specify a valid number of keys to generate (1-10).");
  }
  
  // Generate unique keys
  const generatedKeys = [];
  
  for (let i = 0; i < keyCount; i++) {
    // Generate a unique key
    const key = generateUniqueKey();
    
    // Add to premium keys
    config.PREMIUM_KEYS[key] = {
      used: false,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days
    };
    
    generatedKeys.push(key);
  }
  
  // Reply with the generated keys
  let message = `✅ Generated ${keyCount} premium key${keyCount !== 1 ? 's' : ''}:\n\n`;
  
  generatedKeys.forEach((key, index) => {
    message += `${index + 1}. \`${key}\`\n`;
  });
  
  message += "\nEach key is valid for 30 days from activation and can be used once.";
  
  return ctx.reply(message, { parse_mode: 'Markdown' });
}

/**
 * Generate a unique premium key
 */
function generateUniqueKey() {
  const prefix = 'SC';
  const timestamp = Date.now().toString(36).toUpperCase().slice(-4);
  const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
  
  return `${prefix}-${timestamp}-${randomPart}`;
}

async function profileHandler(ctx) {
    if (!isAdmin(ctx)) {
      return ctx.reply("⚠️ This command is only available to the bot administrator.");
    }
  
    if (!ctx.message.reply_to_message || !ctx.message.reply_to_message.photo) {
      return ctx.reply("⚠️ Please reply to a photo message with this command to set it as the bot's profile picture.");
    }
  
    const photo = ctx.message.reply_to_message.photo;
    const fileId = photo[photo.length - 1].file_id; // highest resolution
  
    try {
      // 1) Get the file link from Telegram
      const fileUrl = await ctx.telegram.getFileLink(fileId);
      console.log("File URL from Telegram:", fileUrl);
  
      // 2) Check protocol
      let fileBuffer;
      const urlObject = new URL(fileUrl);
  
      if (urlObject.protocol === 'file:') {
        // Read file from local path
        // On Linux, urlObject.pathname typically starts with '/', so you can use it directly
        const localPath = urlObject.pathname; 
        fileBuffer = fs.readFileSync(localPath);
      } else {
        // Normal HTTP/HTTPS download with Axios
        const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
        if (!response.data || response.data.length === 0) {
          throw new Error("Received empty file from Telegram.");
        }
        fileBuffer = Buffer.from(response.data);
      }
  
      // 3) Set the chat photo
      await ctx.telegram.setChatPhoto(ctx.chat.id, { source: fileBuffer });
      return ctx.reply("✅ Bot profile picture has been updated.");
  
    } catch (error) {
      console.error("Error updating profile picture:", error.message);
      return ctx.reply("❌ Error updating profile picture. Please try again.");
    }
  }




module.exports = {
  disableHandler,
  revokeHandler,
  genHandler,
  profileHandler,
  isCommandDisabled,
  isAdmin
};