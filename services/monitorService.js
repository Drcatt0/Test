/**
 * Monitor Service - Handles all monitoring and status checking functions
 */
const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../config/config');
const monitoredUsersModel = require('../models/monitoredUsers');
const autoRecordConfigModel = require('../models/autoRecordConfig');
const recordService = require('./recordService');
const memoryService = require('./memoryService');
const browserService = require('./browserService');

// Monitoring intervals
let monitorInterval = null;
let goalCheckInterval = null;

/**
 * Check if a username exists on Stripchat
 * @param {string} username - Username to check
 * @returns {Promise<boolean>} True if username exists
 */
async function checkUsernameExists(username) {
  try {
    const browser = await browserService.getBrowser();
    if (!browser) {
      console.error("Failed to get browser to check username");
      return false;
    }
    const page = await browser.newPage();
    try {
      await page.setDefaultNavigationTimeout(30000);
      const response = await page.goto(`https://stripchat.com/${username}`, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      const exists = response.status() === 200;
      await page.close();
      browserService.releaseBrowser(browser);
      return exists;
    } catch (error) {
      console.error(`Error checking if ${username} exists:`, error);
      await page.close();
      browserService.releaseBrowser(browser);
      return false;
    }
  } catch (error) {
    console.error(`Error launching browser to check if ${username} exists:`, error);
    return false;
  }
}

async function checkStripchatStatus(username) {
    const browser = await puppeteer.launch({
        executablePath: '/usr/bin/chromium-browser',
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    if (!page) {
        console.error("Failed to create a new page in Puppeteer.");
        await browser.close();
        return { isLive: false, thumbnail: null };
    }

    try {
        await page.goto(`https://stripchat.com/${username}`, {
            waitUntil: 'networkidle2',
            timeout: 60000
        });

        // Alternative to waitFor or waitForTimeout
        await new Promise(resolve => setTimeout(resolve, 3000));

        const status = await page.evaluate(() => {
            const liveBadge = document.querySelector('.live-badge');
            const liveStream = document.querySelector('video');
            const liveStatusText = document.querySelector('.status')?.innerText.includes("Live");

            return {
                isLive: liveBadge !== null || liveStream !== null || liveStatusText === true,
                thumbnail: document.querySelector('meta[property="og:image"]')?.content || null
            };
        });

        await browser.close();
        return status;
    } catch (error) {
        console.error("Error checking Stripchat status:", error);
        await browser.close();
        return { isLive: false, thumbnail: null };
    }
}
/**
 * Check and notify about streamer status
 */
async function checkAndNotify(username, chatId, botOrCtx) {
  try {
    const { isLive, thumbnail, goal } = await checkStripchatStatus(username);
    let text = `📢 *${username}* is not live right now.`;
    if (isLive) {
      text = `🔴 *${username}* is currently live! [Watch here](https://stripchat.com/${username})`;
      if (goal && goal.active) {
        const progressBar = generateProgressBar(goal.progress);
        const progressPercentage = Math.floor(goal.progress);
        text += `\n\n🎯 *Goal Progress:* ${progressPercentage}%\n${progressBar}`;
        if (goal.text) {
          const sanitizedText = goal.text
            .replace(/BRA|bra|👙/g, "👚")
            .replace(/OFF|off/g, "")
            .replace(/TAKE/g, "")
            .replace(/🚫|⛔|🔞/g, "")
            .replace(/\s+/g, " ")
            .trim();
          text += `\n*Goal:* ${sanitizedText || "Special Goal"}`;
        }
      }
    }
    try {
      const telegram = botOrCtx.telegram || botOrCtx;
      if (!telegram || typeof telegram.sendMessage !== 'function') {
        console.error('Invalid bot instance provided to checkAndNotify');
        return { isLive, goal };
      }
      if (isLive && thumbnail) {
        await telegram.sendPhoto(chatId, thumbnail, {
          caption: text,
          parse_mode: 'Markdown'
        });
      } else {
        await telegram.sendMessage(chatId, text, { parse_mode: 'Markdown' });
      }
    } catch (error) {
      console.error(`Error sending notification to chat ${chatId}:`, error);
    }
    return { isLive, goal };
  } catch (error) {
    console.error(`Error in checkAndNotify for ${username}:`, error);
    throw error;
  }
}

/**
 * Generate a visual progress bar for goals
 */
function generateProgressBar(percentage, length = 10) {
  const progress = Math.floor((percentage / 100) * length);
  const filled = '█'.repeat(progress);
  const empty = '░'.repeat(length - progress);
  return filled + empty;
}

/**
 * Monitor a batch of streamers
 */
async function monitorBatch(batch, botInstance) {
  const results = [];
  for (const user of batch) {
    try {
      const { username, chatId, isLive: oldLive } = user;
      const { isLive, thumbnail, goal } = await checkStripchatStatus(username);
      const now = new Date();
      const previousGoalCompleted = user.lastGoalCompleted || false;
      user.isLive = isLive;
      user.lastChecked = now.toISOString();
      if (goal && goal.active) {
        user.hasGoal = true;
        user.goalProgress = goal.progress;
        user.goalText = goal.text || '';
        user.goalCompleted = goal.completed;
        if (goal.completed && !previousGoalCompleted && isLive) {
          user.lastGoalCompleted = true;
          // Trigger auto-recording would go here if implemented
        } else {
          user.lastGoalCompleted = goal.completed;
        }
      } else {
        user.hasGoal = false;
        user.lastGoalCompleted = false;
      }
      if (isLive !== oldLive) {
        let text = `📢 *${username}* is no longer live.`;
        if (isLive) {
          text = `🔴 *${username}* is now live! [Watch here](https://stripchat.com/${username})`;
          if (goal && goal.active) {
            text += `\n\n🎯 *Goal Progress:* ${Math.floor(goal.progress)}%`;
            if (goal.text) {
              text += `\n*Goal:* ${goal.text}`;
            }
          }
        }
        try {
          if (isLive && thumbnail) {
            await botInstance.telegram.sendPhoto(chatId, thumbnail, {
              caption: text,
              parse_mode: 'Markdown'
            });
          } else {
            await botInstance.telegram.sendMessage(chatId, text, { parse_mode: 'Markdown' });
          }
        } catch (error) {
          console.error(`Error sending update to chat ${chatId}:`, error);
        }
      }
      results.push({ success: true, user });
    } catch (error) {
      console.error(`Error processing monitored user ${user.username}:`, error);
      results.push({ success: false, user, error });
    }
  }
  return results;
}

/**
 * Start the monitoring routine
 * @param {Object} botInstance - Telegram bot instance
 */
async function startMonitoring(botInstance) {
  console.log("🚀 startMonitoring() is running...");
  // Load models
  await monitoredUsersModel.loadMonitoredUsers();
  await autoRecordConfigModel.loadAutoRecordConfig();
  console.log('✅ Monitoring service started...');

  // Regular monitoring for live users (every 5 minutes)
  monitorInterval = setInterval(async () => {
    console.log("🔍 Running full status check...");
    try {
      await performFullStatusCheck(botInstance);
    } catch (error) {
      console.error("❌ Error in full status check:", error);
    }
  }, config.MONITOR_INTERVAL);

  // Goal monitoring (every 15 seconds) using setTimeout loop
  const runGoalCheck = () => {
    console.log("🔄 Running goal check for auto-recording...");
    checkGoalsForAutoRecording(botInstance)  // Fixed function name typo
      .catch(error => console.error("❌ Error in goal monitoring routine:", error));
    goalCheckInterval = setTimeout(runGoalCheck, config.GOAL_CHECK_INTERVAL);
  };
  
  // Start the initial goal check
  goalCheckInterval = setTimeout(runGoalCheck, config.GOAL_CHECK_INTERVAL);

  console.log('📡 Monitoring is now active!');

  // Initial full status check after 5 seconds - with botInstance properly passed
  setTimeout(async () => {
    try {
      console.log("🔍 Performing initial status check...");
      await performFullStatusCheck(botInstance);
    } catch (error) {
      console.error("❌ Error in initial status check:", error);
    }
  }, 5000);
}

/**
 * Full status check for all monitored users
 */
async function performFullStatusCheck(botInstance) {
  console.log("🔍 Running full status check...");
  try {
    const monitoredUsers = monitoredUsersModel.getAllMonitoredUsers();
    if (monitoredUsers.length === 0) {
      console.log("⚠️ No monitored users found.");
      return;
    }
    console.log(`📡 Checking status for ${monitoredUsers.length} monitored users...`);
    for (const user of monitoredUsers) {
      console.log(`🔍 Checking: ${user.username}`);
      const { isLive, goal } = await checkStripchatStatus(user.username);
      user.isLive = isLive;
      user.goal = goal;
      await checkAndNotify(user.username, user.chatId, botInstance);
      await monitoredUsersModel.saveMonitoredUsers();
    }
    console.log("✅ Full status check complete.");
  } catch (error) {
    console.error("❌ Error in full status check:", error);
  }
}

/**
 * Check goals for live streamers and trigger auto-recording
 * with improved logging and reliability
 */
async function checkGoalsForAutoRecording(botInstance) {
  console.log("🔎 Running goal check for auto-recording...");
  try {
    // Get all monitored users
    const monitoredUsers = monitoredUsersModel.getAllMonitoredUsers();
    if (!monitoredUsers || monitoredUsers.length === 0) {
      console.log("⚠️ No monitored users found, skipping goal check.");
      return;
    }
    
    console.log(`📊 Found ${monitoredUsers.length} monitored users to check`);
    
    // First, update live status for all users
    const livePromises = monitoredUsers.map(async (user) => {
      try {
        // Only check users who were live in the last check or haven't been checked recently
        const lastCheckedTime = user.lastChecked ? new Date(user.lastChecked).getTime() : 0;
        const timeSinceLastCheck = Date.now() - lastCheckedTime;
        
        // If user was previously live or hasn't been checked in 5 minutes, check now
        if (user.isLive || timeSinceLastCheck > 5 * 60 * 1000) {
          console.log(`🔍 Checking live status for ${user.username}...`);
          const status = await checkStripchatStatus(user.username);
          
          // Update user data
          user.isLive = status.isLive;
          user.lastChecked = new Date().toISOString();
          
          if (status.isLive) {
            console.log(`🟢 ${user.username} is LIVE`);
            return { 
              ...user, 
              currentStatus: status 
            };
          } else {
            console.log(`⚫ ${user.username} is OFFLINE`);
          }
        }
      } catch (error) {
        console.error(`Error checking live status for ${user.username}:`, error);
      }
      return null;
    });
    
    // Wait for all checks to complete and filter out offline users
    const checkedUsers = (await Promise.all(livePromises)).filter(u => u !== null);
    
    // Save updated status information
    await monitoredUsersModel.saveMonitoredUsers();
    
    console.log(`🎯 Checking goals for ${checkedUsers.length} live users...`);
    
    // Process each live user for goal completion
    for (const user of checkedUsers) {
      try {
        const { username, chatId } = user;
        const { goal } = user.currentStatus;
        
        if (!goal || !goal.active) {
          console.log(`⚠️ No active goal for ${username}`);
          continue;
        }
        
        // Get previous goal state for comparison
        const previousGoalCompleted = user.lastGoalCompleted || false;
        const previousGoalProgress = user.goalProgress || 0;
        
        // Update goal information
        user.hasGoal = true;
        user.goalProgress = goal.progress;
        user.goalCompleted = goal.completed;
        user.goalText = goal.text || 'Special Goal';
        
        console.log(`📊 ${username} goal: ${goal.progress}% complete (previous: ${previousGoalProgress}%), completed: ${goal.completed}`);
        
        // Check if goal has just been completed (was not completed before, but is now)
        if (goal.completed && !previousGoalCompleted) {
          console.log(`🎉 GOAL COMPLETED for ${username}! Triggering auto-recording...`);
          
          // Get eligible users with auto-record enabled for this streamer
          const eligibleUsers = autoRecordConfigModel.getUsersWithAutoRecordForUsername(username, chatId);
          console.log(`✓ Found ${eligibleUsers.length} eligible users for auto-recording ${username}`);
          
          // Trigger auto-recording for each eligible user
          for (const eligibleUser of eligibleUsers) {
            try {
              console.log(`🎬 Auto-recording for user ID ${eligibleUser.userId}`);
              await triggerGoalAutoRecording(user, botInstance, eligibleUser);
            } catch (recordError) {
              console.error(`Error triggering auto-recording for ${username}:`, recordError);
            }
          }
          
          user.lastGoalCompleted = true;
        } else if (!goal.completed && previousGoalCompleted) {
          // Goal was reset
          console.log(`🔄 Goal for ${username} was reset or started over`);
          user.lastGoalCompleted = false;
        }
      } catch (userError) {
        console.error(`Error processing goal for ${user.username}:`, userError);
      }
    }
    
    // Save the updated goal status information
    await monitoredUsersModel.saveMonitoredUsers();
    
  } catch (error) {
    console.error("❌ Error in goal check routine:", error);
  }
}

/**
 * Trigger auto-recording for a completed goal
 */
async function triggerGoalAutoRecording(user, botInstance, eligibleUser) {
  const { username, chatId, goalText } = user;
  
  // Check if already recording
  if (memoryService.isAutoRecordingActive(chatId, username)) {
    console.log(`⚠️ Already auto-recording ${username}`);
    return false;
  }
  
  // Register this recording as active
  const recordingKey = memoryService.addActiveAutoRecording(chatId, username);
  const duration = eligibleUser.duration || 180; // Default 3 minutes
  
  try {
    console.log(`🎬 Starting auto-recording of ${username} for ${duration} seconds...`);
    
    // Notify the user
    await botInstance.telegram.sendMessage(
      chatId,
      `🎉 *${username}* completed their goal!\n\n` +
        `🎯 *Goal:* ${goalText || 'Special Goal'}\n\n` +
        `🎬 *Auto-recording for ${duration} seconds...*`,
      { parse_mode: 'Markdown' }
    );
    
    // Set up context for recording
    const mockCtx = {
      message: { 
        chat: { id: chatId }, 
        from: { id: eligibleUser.userId }
      },
      reply: (text, options) => botInstance.telegram.sendMessage(chatId, text, options),
      replyWithVideo: (data) => botInstance.telegram.sendVideo(chatId, data.source, data.caption ? { caption: data.caption } : {}),
      telegram: botInstance.telegram
    };
    
    // Execute the recording
    const recordService = require('./recordService');
    await recordService.executeRecord(mockCtx, username, duration);
    
    return true;
  } catch (error) {
    console.error(`❌ Error auto-recording ${username}:`, error);
    return false;
  } finally {
    // Always clean up
    memoryService.removeActiveAutoRecording(recordingKey);
  }
}

/**
 * Start the monitoring routine
 * @param {Object} botInstance - Telegram bot instance
 */
async function startMonitoring(botInstance) {
  console.log("🚀 Starting monitoring service...");
  
  // Load models
  await monitoredUsersModel.loadMonitoredUsers();
  await autoRecordConfigModel.loadAutoRecordConfig();
  
  console.log('✅ Monitoring service initialized');

  // Regular monitoring for live users (every 5 minutes)
  monitorInterval = setInterval(async () => {
    console.log("🔍 Running full status check...");
    try {
      await performFullStatusCheck(botInstance);
    } catch (error) {
      console.error("❌ Error in full status check:", error);
    }
  }, config.MONITOR_INTERVAL);

  // Goal monitoring every 15 seconds using setTimeout loop for better timing accuracy
  // Using a recursive function with setTimeout instead of setInterval
  // This ensures each check completes before starting the next one
  const runGoalCheck = () => {
    const startTime = Date.now();
    
    // Run the goal check
    checkGoalsForAutoRecording(botInstance)
      .catch(error => console.error("❌ Error in goal monitoring routine:", error))
      .finally(() => {
        // Calculate how long the check took
        const elapsed = Date.now() - startTime;
        
        // Calculate time to wait until next check
        // If check took longer than interval, run next check immediately but with small delay
        const nextCheckDelay = Math.max(50, config.GOAL_CHECK_INTERVAL - elapsed);
        
        // Schedule next check
        goalCheckInterval = setTimeout(runGoalCheck, nextCheckDelay);
        
        // Log timing information
        console.log(`🕒 Goal check took ${elapsed}ms, next check in ${nextCheckDelay}ms`);
      });
  };
  
  // Start the initial goal check after a short delay
  console.log(`📅 Scheduling first goal check in 5 seconds...`);
  goalCheckInterval = setTimeout(runGoalCheck, 5000);

  console.log('📡 All monitoring routines are now active!');

  // Run an initial full status check
  try {
    console.log("🔍 Performing initial status check...");
    await performFullStatusCheck(botInstance);
  } catch (error) {
    console.error("❌ Error in initial status check:", error);
  }
}

/**
 * Stop all monitoring routines
 */
function stopMonitoring() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
  if (goalCheckInterval) {
    clearTimeout(goalCheckInterval);  // Changed from clearInterval to clearTimeout
    goalCheckInterval = null;
  }
  console.log('Stopped all monitoring routines');
}

// Export all functions needed by other modules
module.exports = {
  checkStripchatStatus,
  checkUsernameExists,
  checkAndNotify,
  monitorBatch,
  generateProgressBar,
  startMonitoring,
  stopMonitoring,
  performFullStatusCheck,
  checkGoalsForAutoRecording,  // Fixed function name
  triggerGoalAutoRecording
};