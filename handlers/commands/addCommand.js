/**
 * Add Command Handler - COMPLETELY REWRITTEN
 * No dependencies on monitorService at all
 */
const monitoredUsersModel = require('../../models/monitoredUsers');
const browserService = require('../../services/browserService');
const https = require('https');

/**
 * Direct HTTP check if a username exists
 * Doesn't use monitorService at all
 */
async function doesUsernameExist(username) {
  return new Promise((resolve) => {
    // Simple HTTP HEAD request to check if the user exists
    const options = {
      hostname: 'stripchat.com',
      path: `/${username}`,
      method: 'HEAD',
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    };
    
    const req = https.request(options, (res) => {
      // If we get a 200 response or a redirect, the user exists
      resolve(res.statusCode === 200 || res.statusCode === 301 || res.statusCode === 302);
    });
    
    req.on('error', () => {
      // In case of error, we'll say the user doesn't exist
      resolve(false);
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    
    req.end();
  });
}

/**
 * Improved live status detection function
 * This can replace the getCurrentStatus function in addCommand.js
 */
async function getCurrentStatus(username) {
  try {
    // Use the profile page which more reliably shows live status
    const options = {
      hostname: 'stripchat.com',
      path: `/${username}/profile`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Cache-Control': 'no-cache'
      }
    };
    
    return new Promise((resolve) => {
      const req = https.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
          
          // Check for live badge in the first chunk of data
          if (data.includes('live-badge') || data.includes('>LIVE<')) {
            req.destroy(); // Stop receiving data once we find what we need
            resolve({ isLive: true });
          }
          
          // We only need enough data to determine live status
          if (data.length > 20000) {
            req.destroy();
          }
        });
        
        res.on('end', () => {
          // More thorough check for various indicators of live status
          const isLive = data.includes('live-badge') || 
                        data.includes('>LIVE<') || 
                        data.includes('is-live') || 
                        data.includes('isLive":true') ||
                        data.includes('status live');
          
          resolve({ isLive });
        });
      });
      
      req.on('error', (error) => {
        console.error(`Error checking live status for ${username}:`, error.message);
        resolve({ isLive: false });
      });
      
      req.on('timeout', () => {
        req.destroy();
        resolve({ isLive: false });
      });
      
      req.end();
    });
  } catch (error) {
    console.error("Error checking status:", error);
    return { isLive: false };
  }
}

/**
 * /add - Add a user to the monitored list
 */
async function handler(ctx) {
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length < 1) {
    return ctx.reply("⚠️ Usage: /add username\n\nExample: /add AlicePlayss");
  }

  const username = args[0];
  const chatId = ctx.message.chat.id;

  // Check if already monitored
  const monitoredUsers = monitoredUsersModel.getMonitoredUsersForChat(chatId);
  const alreadyMonitored = monitoredUsers.some(
    user => user.username.toLowerCase() === username.toLowerCase()
  );
  
  if (alreadyMonitored) {
    return ctx.reply(`⚠️ You're already monitoring ${username}.`);
  }

  await ctx.reply(`🔍 Checking if ${username} exists...`);
  
  // Validate the username exists before adding - USING LOCAL FUNCTION
  const exists = await doesUsernameExist(username);
  
  if (!exists) {
    return ctx.reply(`❌ Could not find streamer: ${username}`);
  }

  // Add the user to monitored list
  const result = await monitoredUsersModel.addMonitoredUser(username, chatId);
  
  if (!result.success) {
    return ctx.reply(`❌ Error adding ${username}: ${result.message}`);
  }
  
  // Get current status
  try {
    const status = await getCurrentStatus(username);
    
    if (status.isLive) {
      await ctx.reply(`🔴 ${username} is currently LIVE!`);
    } else {
      await ctx.reply(`⚫ ${username} is currently offline.`);
    }
  } catch (error) {
    console.error("Error checking current status:", error);
  }

  return ctx.reply(`✅ Added ${username} to your monitoring list. You'll be notified when they go live.`);
}

module.exports = {
  handler
};