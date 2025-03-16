/**
 * Enhanced Notifier Service - Optimized for Network Efficiency
 * A more reliable system for monitoring streamers and sending notifications
 * Updated with 10-minute check interval & network optimizations
 */
const fs = require('fs-extra');
const path = require('path');
const monitoredUsersModel = require('../models/monitoredUsers');
const autoRecordConfigModel = require('../models/autoRecordConfig');
const recordService = require('./recordService');
const memoryService = require('./memoryService');
const browserService = require('./browserService');
const lightweightChecker = require('./lightweightChecker');
const config = require('../config/config');

// Notification intervals
let streamCheckInterval = null;
let recoveryInterval = null;

// Status tracking
const streamStatus = new Map();
const lastNotifications = new Map();
const failedChecks = new Map();

// Maximum number of failed checks before recovery
const MAX_FAILED_CHECKS = 3;

/**
 * Start the notifier service
 * @param {Object} botInstance - Telegram bot instance
 */
async function startNotifier(botInstance) {
  console.log("🚀 Starting enhanced notifier service...");
  
  // Load models
  await monitoredUsersModel.loadMonitoredUsers();
  await autoRecordConfigModel.loadAutoRecordConfig();
  
  console.log('✅ Notifier service initialized');

  // Override the config value to ensure it runs at the expected interval
  const monitorInterval = 5 * 60 * 1000; // Force 5 minutes for all monitoring
  console.log(`Setting monitor interval to ${monitorInterval}ms (${monitorInterval/1000/60} minutes) - FIXED VALUE`);

  // Start stream check interval (every 5 minutes)
  streamCheckInterval = setInterval(async () => {
    const now = new Date();
    console.log(`🔍 [${now.toISOString()}] Running stream status check (every 5 minutes)...`);
    try {
      await checkAllStreamers(botInstance);
    } catch (error) {
      console.error("❌ Error in stream status check:", error);
    }
  }, monitorInterval); // 5 minutes forced
  
  // Start recovery interval (every 15 minutes)
  recoveryInterval = setInterval(async () => {
    console.log("🔄 Running recovery check...");
    try {
      await performRecoveryCheck();
    } catch (error) {
      console.error("❌ Error in recovery check:", error);
    }
  }, 15 * 60 * 1000);

  console.log('📡 All notifier routines are now active!');

  // Run an initial status check
  try {
    console.log("🔍 Performing initial status check...");
    await checkAllStreamers(botInstance);
  } catch (error) {
    console.error("❌ Error in initial status check:", error);
  }
}

/**
 * Check all monitored streamers with network optimization
 */
async function checkAllStreamers(botInstance) {
  const monitoredUsers = monitoredUsersModel.getAllMonitoredUsers();
  if (monitoredUsers.length === 0) {
    return;
  }
  
  // Only log if there are users to check
  console.log(`📡 Checking ${monitoredUsers.length} monitored streamers...`);
  
  // Group users by username to avoid duplicate checks (more efficient)
  const usernameGroups = {};
  monitoredUsers.forEach(user => {
    const username = user.username.toLowerCase();
    if (!usernameGroups[username]) {
      usernameGroups[username] = [];
    }
    usernameGroups[username].push(user);
  });
  
  // Get unique usernames
  const usernames = Object.keys(usernameGroups);
  console.log(`└─ Processing ${usernames.length} unique streamers`);
  
  // Process usernames in batches for network efficiency
  const batchSize = config.STATUS_CHECK_BATCH_SIZE || 5;
  
  // Track changes for summary
  let liveCount = 0;
  let offlineCount = 0;
  let errorCount = 0;
  
  for (let i = 0; i < usernames.length; i += batchSize) {
    const batch = usernames.slice(i, i + batchSize);
    
    // Process batch in parallel
    const results = await Promise.allSettled(batch.map(async (username) => {
      try {
        const users = usernameGroups[username];
        const status = await checkStreamerStatus(username, users, botInstance);
        return { username, isLive: status.isLive };
      } catch (error) {
        // Increment failed check counter
        const failCount = (failedChecks.get(username) || 0) + 1;
        failedChecks.set(username, failCount);
        errorCount++;
        return { username, error: true };
      }
    }));
    
    // Count status for summary
    results.forEach(result => {
      if (result.status === 'fulfilled') {
        if (!result.value.error) {
          if (result.value.isLive) {
            liveCount++;
          } else {
            offlineCount++;
          }
        }
      } else {
        errorCount++;
      }
    });
    
    // Delay between batches to reduce network load
    if (i + batchSize < usernames.length) {
      await new Promise(resolve => setTimeout(resolve, config.STATUS_CHECK_BATCH_DELAY || 1000));
    }
  }
  
  // Print summary
  console.log(`└─ Status check complete: ${liveCount} live, ${offlineCount} offline, ${errorCount} errors`);
}

/**
 * Check the status of a streamer with better detection and notification
 * Network optimized version
 */
async function checkStreamerStatus(username, users, botInstance) {
  try {
    // Get previous status with reliable defaults
    const prevStatus = streamStatus.get(username) || { 
      isLive: false,
      goal: { active: false, progress: 0, text: '', completed: false }
    };
    
    // Track whether this is the first check for this username
    const isFirstCheck = !streamStatus.has(username);
    
    // Use optimized status checker with caching
    const status = await lightweightChecker.getCachedStatus(username, {
      includeGoal: prevStatus.isLive, // Only include goal info if previously live (saves bandwidth)
      maxAge: prevStatus.isLive ? 2*60*1000 : 5*60*1000, // 2 minutes for live, 5 minutes for offline
      forceRefresh: true // Force refresh for monitoring
    });
    
    // Update status in our tracking
    streamStatus.set(username, status);
    
    // Reset failed checks counter
    failedChecks.set(username, 0);
    
    // Status change detection (offline -> online or online -> offline)
    const statusChanged = status.isLive !== prevStatus.isLive;
    
    // Only notify if status actually changed and this isn't the first check
    if (statusChanged && !isFirstCheck) {
      console.log(`Status change for ${username}: ${prevStatus.isLive ? 'Live→Offline' : 'Offline→Live'}`);
      
      // Send notifications to all users monitoring this streamer
      for (const user of users) {
        try {
          // Create notification key to avoid duplicate notifications
          const notificationKey = `${username}_${user.chatId}_${status.isLive ? 'live' : 'offline'}`;
          
          // Check if we've sent this notification recently (within 10 minutes)
          const lastTime = lastNotifications.get(notificationKey);
          const now = Date.now();
          
          if (lastTime && (now - lastTime < 10 * 60 * 1000)) {
            console.log(`Skipping notification for ${username} (${status.isLive ? 'live' : 'offline'}) - sent recently`);
            continue;
          }
          
          // Format the notification text
          let text;
          if (status.isLive) {
            text = `🔴 *${username}* is now live! [Watch here](https://stripchat.com/${username})`;
            
            // Add goal information if available
            if (status.goal && status.goal.active) {
              const progressBar = generateProgressBar(status.goal.progress);
              const progressPercentage = Math.floor(status.goal.progress);
              
              text += `\n\n🎯 *Goal Progress:* ${progressBar} ${progressPercentage}%`;
              
              // Add token amount if available
              if (status.goal.tokenAmount) {
                text += `\n*Tokens:* ${status.goal.tokenAmount}tk`;
              }
              
              if (status.goal.text) {
                text += `\n*Goal:* ${status.goal.text}`;
              }
            }
          } else {
            text = `⚫ *${username}* is no longer live.`;
            
            // Add next broadcast information if available
            if (status.nextBroadcast) {
              text += `\n\n📆 *Next scheduled broadcast:*\n${status.nextBroadcast}`;
            }
          }
          
          // Send the actual notification
          await botInstance.telegram.sendMessage(user.chatId, text, { 
            parse_mode: 'Markdown',
            disable_web_page_preview: false
          });
          
          // Record the notification time to avoid duplicates
          lastNotifications.set(notificationKey, now);
          
          console.log(`Sent ${status.isLive ? 'live' : 'offline'} notification for ${username} to chat ${user.chatId}`);
        } catch (notifyError) {
          console.error(`Error notifying chat ${user.chatId} about ${username}:`, notifyError);
        }
      }
    }
    
    // Update all users in the model regardless of notification status
    for (const user of users) {
      // Update user data in the monitored users model
      user.isLive = status.isLive;
      user.lastChecked = new Date().toISOString();
      
      if (status.nextBroadcast) {
        user.nextBroadcast = status.nextBroadcast;
      }
      
      if (status.goal) {
        user.hasGoal = status.goal.active;
        user.goalProgress = status.goal.progress;
        user.goalText = status.goal.text || '';
        user.goalCompleted = status.goal.completed;
      }
    }
    
    // Save the updated user status
    await monitoredUsersModel.saveMonitoredUsers();
    
    return status;
  } catch (error) {
    console.error(`Error checking ${username}:`, error);
    
    // Increment failed check counter
    const failCount = (failedChecks.get(username) || 0) + 1;
    failedChecks.set(username, failCount);
    
    throw error;
  }
}

/**
 * Get the status of a streamer - OPTIMIZED VERSION
 * Uses lightweight HTTP checks when possible
 */
async function getStreamerStatus(username) {
  try {
    // Use lightweight cached check
    return await lightweightChecker.getCachedStatus(username, {
      includeGoal: true,
      forceRefresh: true // Always get fresh data for status calls
    });
  } catch (error) {
    console.error(`Error getting status for ${username}:`, error);
    return { 
      isLive: false, 
      goal: { active: false, progress: 0, text: '', completed: false, tokenAmount: 0 },
      nextBroadcast: null
    };
  }
}

/**
 * Recovery check for streamers with persistent failures
 */
async function performRecoveryCheck() {
  // Check failed streamers
  for (const [username, failCount] of failedChecks.entries()) {
    if (failCount >= MAX_FAILED_CHECKS) {
      console.log(`⚠️ Performing recovery check for ${username} after ${failCount} failures`);
      
      try {
        // Reset browser and try a fresh check
        await browserService.resetBrowserPool();
        
        // Reset failed count to give it another chance
        failedChecks.set(username, 0);
      } catch (error) {
        console.error(`Error in recovery check for ${username}:`, error);
      }
    }
  }
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

/**
 * Check and notify about streamer status - improved for direct calls
 */
async function checkAndNotify(username, chatId, botOrCtx) {
  try {
    // Use lightweight check first - with HTTP if possible
    const status = await lightweightChecker.getCachedStatus(username, {
      includeGoal: false, // Skip goal info for initial notification to save bandwidth
      forceRefresh: true  // Always refresh for explicit checks
    });
    
    let text = `📢 *${username}* is not live right now.`;

    if (status.isLive) {
      text = `🔴 *${username}* is currently live! [Watch here](https://stripchat.com/${username})`;
      
      // Only if they're live, get goal info in a second request
      if (!status.goal || !status.goal.active) {
        // Use a simple HTTP check first to avoid browser automation if possible
        const goalStatus = await lightweightChecker.getCachedStatus(username, {
          includeGoal: true,
          forceRefresh: true
        });
        
        if (goalStatus.goal && goalStatus.goal.active) {
          const progressPercentage = Math.floor(goalStatus.goal.progress);
          const progressBar = generateProgressBar(progressPercentage);
          text += `\n\n🎯 *Goal Progress:* ${progressBar} ${progressPercentage}%`;
          if (goalStatus.goal.text) {
            text += `\n*Goal:* ${goalStatus.goal.text || "Special Goal"}`;
          }
        }
      } else if (status.goal.active) {
        const progressPercentage = Math.floor(status.goal.progress);
        const progressBar = generateProgressBar(progressPercentage);
        text += `\n\n🎯 *Goal Progress:* ${progressBar} ${progressPercentage}%`;
        if (status.goal.text) {
          text += `\n*Goal:* ${status.goal.text || "Special Goal"}`;
        }
      }
    } else if (status.nextBroadcast) {
      text += `\n\n📆 *Next scheduled broadcast:*\n${status.nextBroadcast}`;
    }

    try {
      const telegram = botOrCtx.telegram || botOrCtx;
      if (!telegram || typeof telegram.sendMessage !== 'function') {
        console.error('Invalid bot instance provided to checkAndNotify');
        return { isLive: status.isLive, goal: status.goal };
      }

      await telegram.sendMessage(chatId, text, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: false
      });
    } catch (error) {
      console.error(`Error sending notification to chat ${chatId}:`, error);
    }

    return { isLive: status.isLive, goal: status.goal };
  } catch (error) {
    console.error(`Error in checkAndNotify for ${username}:`, error);
    throw error;
  }
}

/**
 * Stop the notifier service
 */
function stopNotifier() {
  if (streamCheckInterval) {
    clearInterval(streamCheckInterval);
    streamCheckInterval = null;
  }
  
  if (recoveryInterval) {
    clearInterval(recoveryInterval);
    recoveryInterval = null;
  }
  
  console.log('Stopped notifier service');
}

/**
 * Restart the notifier service
 */
function restartNotifier(botInstance) {
  console.log("🔄 Restarting notifier service...");
  stopNotifier();
  
  // Wait a moment for clean shutdown
  setTimeout(() => {
    startNotifier(botInstance);
  }, 5000);
}

module.exports = {
  startNotifier,
  stopNotifier,
  restartNotifier,
  getStreamerStatus,
  checkStreamerStatus,
  checkAllStreamers,
  checkAndNotify,
  streamCheckInterval
};