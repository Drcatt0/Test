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

// In services/monitorService.js, update the checkStripchatStatus function to better extract goal information

  // Ensure it's correctly imported

async function checkStripchatStatus(username) {
    let page = null;
    const result = { isLive: false, thumbnail: null, goal: { active: false, completed: false } };

    try {
        // ✅ Use browserService to get the browser instance
        const browser = await browserService.getBrowser();
        if (!browser) {
            console.error("🚨 Failed to get browser instance");
            return result;
        }

        page = await browser.newPage();

        // Optimize browser behavior
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (['image', 'font', 'media'].includes(resourceType) && !req.url().includes('thumbnail')) {
                req.abort();
            } else {
                req.continue();
            }
        });

        // Force fresh data (avoid caching)
        await page.setDefaultNavigationTimeout(30000);
        await page.goto(`https://stripchat.com/${username}`, {
            waitUntil: 'networkidle2',
            timeout: 30000,
            cache: 'reload'
        });

        // Extract live status, thumbnail, and goal information
        const pageData = await page.evaluate(() => {
            const liveBadge = document.querySelector(".live-badge, .status-live, .broadcasting, [class*='live']");
            const greenDot = document.querySelector(".user-status__dot--online, .green-dot, [class*='status-green']");
            const videoElement = document.querySelector("video");
            const offlineBadge = document.querySelector(".offline, .status-offline, .streamer-offline");
            const nextBroadcast = Array.from(document.querySelectorAll("div, span, p, h3"))
                .some(el => el.innerText.includes("Next broadcast"));

            // ✅ Improved live detection logic (like your Discord bot)
            const isLive = !!((greenDot || liveBadge) && videoElement && !offlineBadge && !nextBroadcast);

            // Override live detection if "Next broadcast" exists
            if (nextBroadcast) {
                console.log("❌ Detected 'Next broadcast' – forcing offline.");
                return { isLive: false, thumbnail: null, goal: {} };
            }

            // Extract thumbnail
            const thumb = document.querySelector('meta[property="og:image"]')?.content;

            // ✅ Goal tracking logic
            let goal = {
                active: false,
                completed: false,
                progress: 0,
                totalAmount: 0,
                currentAmount: 0,
                text: ''
            };

            const goalElements = [
                document.querySelector('.goal-widget'),
                document.querySelector('.epic-goal-progress_information'),
                document.querySelector('[data-test="goal-container"]'),
                ...Array.from(document.querySelectorAll('[class*="goal"]')).filter(el =>
                    el.innerHTML.includes('progress') || el.innerHTML.includes('bar') || el.innerHTML.includes('%') ||
                    el.innerHTML.includes('tk')
                )
            ].filter(Boolean);

            if (goalElements.length > 0) {
                const goalElement = goalElements[0];
                goal.active = true;

                // Extract progress percentage
                const progressEl = goalElement.querySelector('[class*="progress"], .progress-bar');
                if (progressEl) {
                    const progressMatch = progressEl.textContent?.match(/(\d+(?:\.\d+)?)\s*%/);
                    if (progressMatch) {
                        goal.progress = parseFloat(progressMatch[1]);
                    }
                }

                // Extract token amount
                const tokenEl = goalElement.querySelector('[class*="tokens"], .goal-tokens');
                if (tokenEl) {
                    const tokenMatch = tokenEl.textContent?.match(/(\d+)\s*tk/i);
                    if (tokenMatch) {
                        goal.currentAmount = parseInt(tokenMatch[1], 10);
                    }
                }

                // Extract goal text
                const textEl = goalElement.querySelector('.goal-text, .title, h3, span:not([class*="tokens"])');
                if (textEl) {
                    goal.text = textEl.innerText.trim();
                }

                // Check if completed
                goal.completed = goal.progress >= 99;
            }

            return {
                isLive,
                thumbnail: thumb || null,
                goal
            };
        });

        // Debugging output
        console.log(`🔍 DEBUG Live Detection for ${username}:`, pageData);

        await page.close();
        browserService.releaseBrowser(browser);  // ✅ Properly release the browser
        return pageData;
    } catch (error) {
        console.error(`❌ Error checking status for ${username}:`, error);
        if (page) {
            try {
                await page.close();
            } catch (e) {}
        }
        browserService.releaseBrowser(browser);  // ✅ Ensure release even on failure
        return result;
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
                    text += `\n*Goal:* ${goal.text || "Special Goal"}`;
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
    }, 5 * 60 * 1000); // 5 minutes

    // Goal monitoring every 20 seconds for auto-record users
    const runGoalCheck = () => {
        const startTime = Date.now();
        
        // Run the goal check
        checkGoalsForAutoRecording(botInstance)
            .catch(error => console.error("❌ Error in goal monitoring routine:", error))
            .finally(() => {
                // Calculate next check time
                const elapsed = Date.now() - startTime;
                const nextCheckDelay = Math.max(50, 20000 - elapsed); // 20 seconds
                
                // Schedule next check
                goalCheckInterval = setTimeout(runGoalCheck, nextCheckDelay);
                
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
async function performFullStatusCheck(botInstance) {
    const now = new Date().toISOString();
    console.log(`[${now}] 🔍 Running full status check...`);
    
    try {
        const monitoredUsers = monitoredUsersModel.getAllMonitoredUsers();
        if (monitoredUsers.length === 0) {
            console.log(`[${now}] ⚠️ No monitored users found.`);
            return;
        }
        
        console.log(`[${now}] 📡 Checking status for ${monitoredUsers.length} monitored users...`);
        
        // Process users in batches of 3 to avoid overwhelming the browser
        const batchSize = 3;
        for (let i = 0; i < monitoredUsers.length; i += batchSize) {
            const batch = monitoredUsers.slice(i, i + batchSize);
            
            console.log(`[${now}] 📊 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(monitoredUsers.length/batchSize)} (${batch.map(u => u.username).join(', ')})`);
            
            // Process batch in parallel
            await Promise.all(batch.map(async (user) => {
                try {
                    console.log(`[${now}] 🔍 Checking: ${user.username} (chatId: ${user.chatId})`);
                    const { isLive, goal } = await checkStripchatStatus(user.username);
                    
                    // Log the result
                    if (isLive) {
                        console.log(`[${now}] 🟢 ${user.username} is LIVE${goal && goal.active ? `, Goal: ${goal.progress.toFixed(1)}%` : ''}`);
                    } else {
                        console.log(`[${now}] ⚫ ${user.username} is OFFLINE`);
                    }
                    
                    // Update user status
                    const oldLiveStatus = user.isLive;
                    user.isLive = isLive;
                    user.goal = goal;
                    user.lastChecked = new Date().toISOString();
                    
                    // Send notification only if status changed
                    if (isLive !== oldLiveStatus) {
                        console.log(`[${now}] 📢 Status change for ${user.username}: ${oldLiveStatus ? 'Live→Offline' : 'Offline→Live'}`);
                        await checkAndNotify(user.username, user.chatId, botInstance);
                    }
                } catch (error) {
                    console.error(`[${now}] ❌ Error checking ${user.username}:`, error);
                }
            }));
            
            // Small delay between batches to prevent overwhelming resources
            if (i + batchSize < monitoredUsers.length) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        // Save updated user status
        await monitoredUsersModel.saveMonitoredUsers();
        
        console.log(`[${now}] ✅ Full status check complete.`);
    } catch (error) {
        console.error(`[${now}] ❌ Error in full status check:`, error);
    }
}

/**
 * Check goals for live streamers and trigger auto-recording
 * with improved logging and reliability
 */
async function checkGoalsForAutoRecording(botInstance) {
    const now = new Date().toISOString();
    console.log(`[${now}] 🎯 Checking goals for auto-recording...`);
    
    try {
        // Get all monitored users
        const monitoredUsers = monitoredUsersModel.getAllMonitoredUsers();
        if (!monitoredUsers || monitoredUsers.length === 0) {
            console.log(`[${now}] ⚠️ No monitored users found, skipping goal check.`);
            return;
        }
        
        // Get only users with auto-record enabled
        const usersWithAutoRecord = [];
        for (const user of monitoredUsers) {
            const autoRecordUsers = autoRecordConfigModel.getUsersWithAutoRecordForUsername(user.username, user.chatId);
            if (autoRecordUsers.length > 0) {
                usersWithAutoRecord.push(user);
            }
        }
        
        console.log(`[${now}] 🎯 Found ${usersWithAutoRecord.length} users with auto-record enabled`);
        
        if (usersWithAutoRecord.length === 0) {
            return;
        }
        
        // Only check live users
        let liveUsers = usersWithAutoRecord.filter(user => user.isLive);
        
        // If we don't have any known live users, do a quick check on all of them
        if (liveUsers.length === 0) {
            console.log(`[${now}] 📺 No known live users with auto-record, checking statuses...`);
            
            // Check in batches of 2 to avoid overwhelming resources
            const batchSize = 2;
            for (let i = 0; i < usersWithAutoRecord.length; i += batchSize) {
                const batch = usersWithAutoRecord.slice(i, i + batchSize);
                
                await Promise.all(batch.map(async (user) => {
                    try {
                        console.log(`[${now}] 🔍 Quick checking if ${user.username} is live`);
                        const status = await checkStripchatStatus(user.username);
                        
                        user.isLive = status.isLive;
                        user.lastChecked = new Date().toISOString();
                        
                        if (status.isLive) {
                            console.log(`[${now}] 🟢 ${user.username} is LIVE`);
                            liveUsers.push({...user, currentStatus: status});
                        } else {
                            console.log(`[${now}] ⚫ ${user.username} is OFFLINE`);
                        }
                    } catch (error) {
                        console.error(`[${now}] ❌ Error checking live status for ${user.username}:`, error);
                    }
                }));
                
                // Small delay between batches
                if (i + batchSize < usersWithAutoRecord.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }
        
        // Process each live user for goal completion
        console.log(`[${now}] 🎯 Checking goals for ${liveUsers.length} live users with auto-record...`);
        
        for (const user of liveUsers) {
            try {
                const { username, chatId } = user;
                let goal;
                
                // Use existing goal data if recent, otherwise fetch fresh data
                if (user.currentStatus && user.currentStatus.goal) {
                    goal = user.currentStatus.goal;
                } else if (user.goal && user.goal.active) {
                    goal = user.goal;
                } else {
                    console.log(`[${now}] 🔄 Fetching fresh goal data for ${username}`);
                    const status = await checkStripchatStatus(username);
                    goal = status.goal;
                    user.isLive = status.isLive;
                }
                
                if (!goal || !goal.active) {
                    console.log(`[${now}] ⚠️ No active goal for ${username}`);
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
                
                console.log(`[${now}] 📊 ${username} goal: ${goal.progress}% complete (previous: ${previousGoalProgress}%), completed: ${goal.completed}`);
                
                // Check if goal has just been completed
                if (goal.completed && !previousGoalCompleted) {
                    console.log(`[${now}] 🎉 GOAL COMPLETED for ${username}! Triggering auto-recording...`);
                    
                    // Get eligible users with auto-record enabled for this streamer
                    const eligibleUsers = autoRecordConfigModel.getUsersWithAutoRecordForUsername(username, chatId);
                    console.log(`[${now}] ✓ Found ${eligibleUsers.length} eligible users for auto-recording ${username}`);
                    
                    // Trigger auto-recording for each eligible user
                    for (const eligibleUser of eligibleUsers) {
                        try {
                            console.log(`[${now}] 🎬 Auto-recording for user ID ${eligibleUser.userId}`);
                            await triggerGoalAutoRecording(user, botInstance, eligibleUser);
                        } catch (recordError) {
                            console.error(`[${now}] ❌ Error triggering auto-recording for ${username}:`, recordError);
                        }
                    }
                    
                    user.lastGoalCompleted = true;
                } else if (!goal.completed && previousGoalCompleted) {
                    // Goal was reset
                    console.log(`[${now}] 🔄 Goal for ${username} was reset or started over`);
                    user.lastGoalCompleted = false;
                }
            } catch (userError) {
                console.error(`[${now}] ❌ Error processing goal for ${user.username}:`, userError);
            }
        }
        
        // Save the updated goal status information
        await monitoredUsersModel.saveMonitoredUsers();
        
        console.log(`[${now}] ✅ Goal check complete.`);
        
    } catch (error) {
        console.error(`[${now}] ❌ Error in goal check routine:`, error);
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
// Add this after stopMonitoring function
function restartMonitoring(botInstance) {
    console.log("🔄 Restarting monitoring service...");
    stopMonitoring();
    
    // Wait a moment to ensure clean shutdown
    setTimeout(() => {
        startMonitoring(botInstance);
    }, 5000);
}

// Add to module.exports
module.exports = {
    // existing exports
    restartMonitoring
};
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