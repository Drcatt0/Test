/**
 * Goal Monitor Service - SIMPLIFIED & OPTIMIZED
 * Only notifies when goal reaches 100% and triggers recording
 * With network usage optimization
 */
const browserService = require('./browserService');
const monitoredUsersModel = require('../models/monitoredUsers');
const autoRecordConfigModel = require('../models/autoRecordConfig');
const recordService = require('./recordService');
const memoryService = require('./memoryService');
const lightweightChecker = require('./lightweightChecker');

// Tracking active goal monitors
const activeGoalMonitors = new Map(); // username => {lastChecked, isLive, goal, chatIds, userIds}
let monitorInterval = null;

/**
 * Start the goal monitoring service
 * @param {Object} botInstance - Telegram bot instance
 */
async function startGoalMonitoring(botInstance) {
  console.log("🎯 Starting enhanced goal monitoring service...");
  
  // Stop any existing interval
  if (monitorInterval) {
    clearInterval(monitorInterval);
  }
  
  // Force reset the interval to 10 seconds
  const checkInterval = 10 * 1000; // 10 seconds regardless of config
  console.log(`Setting goal check interval to ${checkInterval}ms (${checkInterval/1000} seconds)`);
  
  // Start the monitoring interval
  monitorInterval = setInterval(async () => {
    try {
      console.log("🔍 Running goal status check...");
      await monitorAllGoals(botInstance);
    } catch (error) {
      console.error("❌ Error in goal monitoring routine:", error);
    }
  }, checkInterval);
  
  console.log("✅ Goal monitoring service started (checking every 10 seconds)");
  
  // Initial setup of monitors
  await setupInitialMonitors();
}

/**
 * Set up initial monitors from saved configurations
 */
async function setupInitialMonitors() {
  try {
    // Load all monitored users
    const monitoredUsers = monitoredUsersModel.getAllMonitoredUsers();
    
    // Get all auto-record configurations
    const autoRecordConfigs = autoRecordConfigModel.getAllAutoRecordConfigs();
    const enabledConfigs = Object.entries(autoRecordConfigs)
      .filter(([userId, config]) => config.enabled);
    
    console.log(`Found ${enabledConfigs.length} enabled auto-record configurations`);
    
    // Setup monitors for each enabled config
    for (const [userId, config] of enabledConfigs) {
      if (config.usernames && config.usernames.length > 0) {
        for (const username of config.usernames) {
          // Find matching monitored users
          const matchingUsers = monitoredUsers.filter(u => 
            u.username.toLowerCase() === username.toLowerCase() && 
            u.chatId.toString() === config.chatId
          );
          
          if (matchingUsers.length > 0) {
            // Start monitoring this username
            startMonitoringGoal(username, [parseInt(config.chatId, 10)], [parseInt(userId, 10)]);
            console.log(`⚙️ Set up initial goal monitoring for ${username} (User ID: ${userId})`);
          }
        }
      }
    }
    
    console.log(`✅ Initial goal monitors set up: ${activeGoalMonitors.size} active monitors`);
  } catch (error) {
    console.error("Error setting up initial goal monitors:", error);
  }
}

/**
 * Start monitoring a streamer for goal completion
 */
function startMonitoringGoal(username, chatIds, userIds) {
  // Normalize inputs
  const normalizedUsername = username.toLowerCase();
  const chatIdSet = new Set(chatIds.map(id => id.toString()));
  const userIdSet = new Set(userIds.map(id => id.toString()));
  
  // Update or create monitor
  if (activeGoalMonitors.has(normalizedUsername)) {
    // Update existing monitor
    const monitor = activeGoalMonitors.get(normalizedUsername);
    
    // Add new chat IDs
    chatIds.forEach(id => monitor.chatIds.add(id.toString()));
    
    // Add new user IDs
    userIds.forEach(id => monitor.userIds.add(id.toString()));
    
    console.log(`Updated goal monitor for ${normalizedUsername}: ${monitor.chatIds.size} chats, ${monitor.userIds.size} users`);
  } else {
    // Create new monitor
    activeGoalMonitors.set(normalizedUsername, {
      lastChecked: Date.now(),
      isLive: true, // Assume live to start
      goal: null,   // Not checked yet
      chatIds: chatIdSet,
      userIds: userIdSet,
      failCount: 0
    });
    
    console.log(`Started new goal monitor for ${normalizedUsername}`);
  }
  
  return true;
}

/**
 * Stop monitoring a streamer for goal completion
 */
function stopMonitoringGoal(username) {
  const normalizedUsername = username.toLowerCase();
  const wasMonitored = activeGoalMonitors.has(normalizedUsername);
  
  if (wasMonitored) {
    activeGoalMonitors.delete(normalizedUsername);
    console.log(`Stopped goal monitoring for ${normalizedUsername}`);
  }
  
  return wasMonitored;
}

/**
 * Process all active goal monitors
 */
async function monitorAllGoals(botInstance) {
  // Skip processing if no monitors active (saves console spam)
  if (activeGoalMonitors.size === 0) {
    return;
  }
  
  // Use a more concise log format
  console.log(`🎯 Checking ${activeGoalMonitors.size} active goal monitors...`);
  
  // Process in small batches to avoid overwhelming the network
  const batchSize = 3; 
  const usernames = Array.from(activeGoalMonitors.keys());
  
  for (let i = 0; i < usernames.length; i += batchSize) {
    const batch = usernames.slice(i, i + batchSize);
    
    // Process batch in parallel
    await Promise.all(batch.map(async (username) => {
      try {
        await checkGoalStatus(username, botInstance);
      } catch (error) {
        console.error(`Error monitoring goal for ${username}:`, error);
        
        // Track failures
        const monitor = activeGoalMonitors.get(username);
        if (monitor) {
          monitor.failCount = (monitor.failCount || 0) + 1;
          
          // If too many failures, stop monitoring
          if (monitor.failCount > 5) {
            console.log(`Too many failures (${monitor.failCount}) for ${username}, stopping goal monitor`);
            stopMonitoringGoal(username);
          }
        }
      }
    }));
    
    // Add small delay between batches
    if (i + batchSize < usernames.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

/**
 * Check the status of a goal for a specific streamer
 * Simplified to only notify on 100% completion
 * OPTIMIZED for network efficiency
 */
async function checkGoalStatus(username, botInstance) {
  const normalizedUsername = username.toLowerCase();
  const monitor = activeGoalMonitors.get(normalizedUsername);
  
  if (!monitor) {
    return false;
  }
  
  // Check if we're checking too frequently (minimum 5 seconds between checks)
  const now = Date.now();
  const timeSinceLastCheck = now - monitor.lastChecked;
  
  if (timeSinceLastCheck < 5000) {
    return false;
  }
  
  // Update last checked time
  monitor.lastChecked = now;
  
  // Get the streamer's status using lightweight checker
  let status;
  try {
    status = await getStreamStatus(username);
    
    // Add diagnostic logging
    console.log(`Goal status for ${username}: live=${status.isLive}, ` +
      `hasGoal=${status.goal?.active || false}, ` +
      `progress=${status.goal?.progress || 0}, ` +
      `text="${status.goal?.text || 'None'}", ` +
      `completed=${status.goal?.completed || false}`);
    
  } catch (error) {
    console.error(`Error getting stream status for ${username}:`, error);
    
    // Track failures
    monitor.failCount = (monitor.failCount || 0) + 1;
    
    // If too many failures, stop monitoring
    if (monitor.failCount > 5) {
      console.log(`Too many failures (${monitor.failCount}) for ${username}, stopping goal monitor`);
      activeGoalMonitors.delete(normalizedUsername);
    }
    
    return false;
  }
  
  // Reset fail count on successful check
  monitor.failCount = 0;
  
  // If user is not live, mark as offline
  if (!status.isLive) {
    const wasLive = monitor.isLive;
    monitor.isLive = false;
    
    // Only notify if state changed from live to offline
    if (wasLive) {
      console.log(`🔴→⚫ ${username} is no longer live, pausing goal monitoring`);
      
      // Notify all chats, but only if the streamer was previously live
      for (const chatId of monitor.chatIds) {
        try {
          await botInstance.telegram.sendMessage(
            chatId,
            `⚫ *${username}* is no longer live. Goal monitoring paused.`,
            { parse_mode: 'Markdown' }
          );
        } catch (error) {
          console.error(`Error sending offline notification for ${username} to ${chatId}:`, error);
        }
      }
    }
    
    return false;
  }
  
  // If user was offline but is now live, send notification
  if (!monitor.isLive) {
    console.log(`⚫→🔴 ${username} is live again, resuming goal monitoring`);
    monitor.isLive = true;
    
    // Reset goal data
    monitor.goal = null;
    
    // Notify all chats
    for (const chatId of monitor.chatIds) {
      try {
        await botInstance.telegram.sendMessage(
          chatId,
          `🔴 *${username}* is live again! Goal monitoring has resumed.`,
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        console.error(`Error sending live notification for ${username} to ${chatId}:`, error);
      }
    }
  }
  
  // Skip if no active goal
  if (!status.goal || !status.goal.active) {
    if (monitor.goal && monitor.goal.active) {
      console.log(`${username}'s goal has been removed or completed`);
      monitor.goal = null;
    }
    return false;
  }
  
  // First check or goal reset, just store the data
  if (!monitor.goal) {
    console.log(`${username} has a new goal: ${status.goal.text || 'No text'} (${status.goal.progress}%)`);
    monitor.goal = status.goal;
    return true;
  }
  
  // Check for goal change
  if (status.goal.text && monitor.goal.text && 
      status.goal.text !== monitor.goal.text) {
    
    console.log(`${username}'s goal changed from "${monitor.goal.text}" to "${status.goal.text}"`);
    
    // Goal has changed, update but don't notify
    monitor.goal = status.goal;
    return true;
  }
  
  // Update progress without notifications for intermediate progress
  monitor.goal.progress = status.goal.progress;
  
  // Check for goal completion (100% or very close to it)
  const isCompleted = status.goal.progress >= 99;
  const wasCompleted = monitor.goal.completed || false;
  
  console.log(`Goal completion check for ${username}: ` +
    `progress=${Math.round(status.goal.progress)}%, ` +
    `threshold=99%, ` +
    `isCompleted=${isCompleted}, ` +
    `wasCompleted=${wasCompleted}`);
  
  if (isCompleted && !wasCompleted) {
    console.log(`🎉 Goal completed for ${username}! Progress: ${Math.round(status.goal.progress)}%`);
    
    // Update goal status
    monitor.goal.completed = true;
    
    // Notify all chats about goal completion
    for (const chatId of monitor.chatIds) {
      try {
        await botInstance.telegram.sendMessage(
          chatId,
          `🎉 *${username}* has completed their goal!`,
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        console.error(`Error sending goal completion notification for ${username} to ${chatId}:`, error);
      }
      
      // Get eligible users for recording
      try {
        const autoRecordUsers = autoRecordConfigModel.getUsersWithAutoRecordForUsername(username, chatId);
        
        // Trigger recording for each eligible user
        for (const eligibleUser of autoRecordUsers) {
          try {
            // Skip if this user ID isn't in our monitor's list
            if (!monitor.userIds.has(eligibleUser.userId.toString())) {
              continue;
            }
            
            console.log(`Triggering auto-recording for ${username} - User ID: ${eligibleUser.userId}`);
            
            // Trigger recording with better error handling
            await triggerGoalRecording(username, status.goal, chatId, botInstance, eligibleUser)
              .catch(err => {
                console.error(`Error in auto-recording for ${username}:`, err);
                
                // Notify user about the recording failure
                botInstance.telegram.sendMessage(
                  chatId,
                  `⚠️ Failed to auto-record ${username}'s goal completion. Please try recording manually with /record ${username} 60`,
                  { parse_mode: 'Markdown' }
                ).catch(() => {});
              });
          } catch (recordError) {
            console.error(`Error recording goal for ${username} in chat ${chatId}:`, recordError);
          }
        }
      } catch (error) {
        console.error(`Error processing auto-record for ${username} in chat ${chatId}:`, error);
      }
    }
    
    return true;
  }
  
  // Update the saved goal information
  monitor.goal = status.goal;
  
  return true;
}

/**
 * Trigger auto-recording for a completed goal
 */
async function triggerGoalRecording(username, goal, chatId, botInstance, eligibleUser) {
  // Check if already recording
  if (memoryService.isAutoRecordingActive(chatId, username)) {
    console.log(`Already auto-recording ${username}, skipping duplicate recording`);
    return false;
  }
  
  // Register this recording as active
  const recordingKey = memoryService.addActiveAutoRecording(chatId, username);
  const duration = eligibleUser.duration || 180; // Default 3 minutes
  
  try {
    console.log(`🎬 Starting auto-recording of ${username} for ${duration} seconds...`);
    
    // Sanitize goal text
    const sanitizedGoalText = goal.text
      ? goal.text
          .replace(/BRA|bra|👙/g, "👚")
          .replace(/TAKE OFF/g, "OUTFIT")
          .replace(/OFF/g, "")
          .replace(/TAKE/g, "")
          .replace(/🚫|⛔|🔞/g, "")
          .replace(/\s+/g, " ")
          .trim()
      : "Special Goal";
    
    // Notify the user with a more informative message
    await botInstance.telegram.sendMessage(
      chatId,
      `🎬 *Auto-recording ${username} for ${duration} seconds!*\n\n` +
      `🎯 *Goal Completed:* ${sanitizedGoalText}\n\n` +
      `Recording will be sent when complete...`,
      { parse_mode: 'Markdown' }
    );
    
    // Set up context for recording
    const mockCtx = {
      message: { 
        chat: { id: chatId }, 
        from: { id: eligibleUser.userId }
      },
      reply: (text, options) => botInstance.telegram.sendMessage(chatId, text, options),
      replyWithVideo: (data) => botInstance.telegram.sendVideo(chatId, data.source, 
        data.caption ? { caption: data.caption } : {}),
      telegram: botInstance.telegram
    };
    
    // Execute the recording with retry
    let success = false;
    let attempts = 0;
    const maxAttempts = 2;
    
    while (!success && attempts < maxAttempts) {
      attempts++;
      try {
        console.log(`Recording attempt ${attempts} for ${username}`);
        await recordService.executeRecord(mockCtx, username, duration);
        success = true;
        
        // Send success message
        if (success) {
          await botInstance.telegram.sendMessage(
            chatId,
            `✅ Successfully recorded ${username}'s goal completion!`,
            { parse_mode: 'Markdown' }
          );
        }
      } catch (error) {
        console.error(`Error recording ${username} (attempt ${attempts}):`, error);
        
        if (attempts >= maxAttempts) {
          await botInstance.telegram.sendMessage(
            chatId,
            `⚠️ Failed to record ${username} after ${attempts} attempts. The stream may have ended or changed format.`,
            { parse_mode: 'Markdown' }
          );
        } else {
          // Wait a bit before retrying
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
    }
    
    return success;
  } catch (error) {
    console.error(`Error auto-recording ${username}:`, error);
    throw error; // Rethrow so the caller can handle it
  } finally {
    // Always clean up
    memoryService.removeActiveAutoRecording(recordingKey);
  }
}

/**
 * Get the status of a streamer - OPTIMIZED VERSION
 * Uses lightweight HTTP checks when possible
 */
async function getStreamStatus(username) {
  try {
    // Use lightweight cached check with forced refresh for goal monitoring
    // since we need the most up-to-date data for goals
    return await lightweightChecker.getCachedStatus(username, {
      includeGoal: true,
      forceRefresh: true, // Always get fresh data for goal monitoring
      maxAge: 5000 // Very short cache time (5 seconds) for goal monitoring
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
 * Generate a visual progress bar
 */
function generateProgressBar(percentage, length = 10) {
  const progress = Math.floor((percentage / 100) * length);
  const filled = '█'.repeat(progress);
  const empty = '░'.repeat(length - progress);
  return filled + empty;
}

/**
 * Stop the goal monitoring service
 */
function stopGoalMonitoring() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
  
  activeGoalMonitors.clear();
  console.log('Stopped goal monitoring service');
}

module.exports = {
  startGoalMonitoring,
  stopGoalMonitoring,
  startMonitoringGoal,
  stopMonitoringGoal,
  getStreamStatus,
  checkGoalStatus,
  monitorAllGoals,
  activeGoalMonitors
};