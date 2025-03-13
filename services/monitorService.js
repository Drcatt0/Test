/**
 * Monitor Service - Simplified version for better reliability
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

/**
 * Check the live status of a Stripchat username - FIXED VERSION
 * Uses the profile page and improved detection
 * @param {string} username - Stripchat username to check
 * @returns {Promise<Object>} Status information including isLive and other data
 */
async function checkStripchatStatus(username) {
  let browser = null;
  let page = null;
  const result = { 
    isLive: false, 
    thumbnail: null, 
    goal: { 
      active: false,
      completed: false,
      progress: 0,
      text: '',
      currentAmount: 0 
    } 
  };

  try {
    console.log(`🔍 Checking status for ${username}...`);
    
    // Get browser instance
    browser = await browserService.getBrowser();
    if (!browser) {
      console.error(`🚨 Failed to get browser instance for ${username}`);
      return result;
    }

    // Create a new page with optimized settings
    page = await browser.newPage();
    
    // Set random user agent
    await page.setUserAgent(browserService.getRandomUserAgent());
    
    // Block unnecessary resources for better performance
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (['font', 'media', 'websocket'].includes(resourceType) || 
          (resourceType === 'image' && !req.url().includes('thumb'))) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Set timeouts
    await page.setDefaultNavigationTimeout(30000);
    
    // Specifically go to the profile page as requested
    const cacheBuster = Date.now();
    console.log(`Opening profile URL: https://stripchat.com/${username}/profile?_=${cacheBuster}`);
    await page.goto(`https://stripchat.com/${username}/profile?_=${cacheBuster}`, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Wait for profile elements to load
    await page.waitForSelector('.profile-cover_avatar-wrapper, [class*="profile-cover_avatar-wrapper"], .avatar, [class*="avatar"]', { 
      timeout: 10000 
    }).catch(() => {
      console.log(`Timeout waiting for profile elements for ${username}, proceeding anyway`);
    });

    // Log page content size for debugging
    const pageContent = await page.content();
    console.log(`Profile page loaded for ${username} with ${pageContent.length} characters`);

    // Check live status from the profile page
    const profileStatus = await page.evaluate(() => {
      // Look specifically for the live badge in the profile avatar wrapper as shown in screenshots
      const liveBadge = document.querySelector('.live-badge, [class*="live-badge"]');
      console.log('Live badge found:', liveBadge !== null);
      
      const isLive = !!liveBadge;
      
      // Get thumbnail if available
      const thumbnail = document.querySelector('meta[property="og:image"]')?.content ||
                        document.querySelector('.profile-cover_avatar-wrapper img, [class*="profile-cover_avatar-wrapper"] img, .avatar img, [class*="avatar"] img')?.src;
      
      // Get next broadcast if not live
      let nextBroadcast = null;
      if (!isLive) {
        const scheduleElements = document.querySelectorAll('.schedule-next-informer__weekday, .schedule-next-informer__link, [class*="schedule-next"]');
        if (scheduleElements.length > 0) {
          let broadcastText = '';
          scheduleElements.forEach(el => {
            broadcastText += el.textContent.trim() + ' ';
          });
          nextBroadcast = broadcastText.trim();
        }
      }
      
      return { 
        isLive,
        thumbnail,
        nextBroadcast
      };
    });
    
    console.log(`Profile check result for ${username}: Live=${profileStatus.isLive}`);
    
    // Update result with profile data
    result.isLive = profileStatus.isLive;
    result.thumbnail = profileStatus.thumbnail;
    result.nextBroadcast = profileStatus.nextBroadcast;
    
    // If live, go to main page to check for goal information
    if (profileStatus.isLive) {
      console.log(`${username} is LIVE - checking goal information`);
      await page.goto(`https://stripchat.com/${username}?_=${cacheBuster}`, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      // Wait for content
      await page.waitForFunction(() => {
        const goalElements = document.querySelectorAll('[role="progressbar"], [class*="progress"], [class*="goal"]');
        console.log('Goal elements found:', goalElements.length);
        return goalElements.length > 0 || document.querySelector('video') !== null;
      }, { timeout: 10000 }).catch(() => {
        console.log(`Timeout waiting for main page elements for ${username}`);
      });
      
      // Extract goal information
      const goalInfo = await page.evaluate(() => {
        const goal = {
          active: false,
          completed: false,
          progress: 0,
          text: '',
          currentAmount: 0
        };
        
        // Look for goal progress elements
        const progressElements = document.querySelectorAll('[role="progressbar"], [class*="progress"], [class*="goal"]');
        if (progressElements.length > 0) {
          goal.active = true;
          console.log('Found active goal');
          
          // Try to extract progress percentage
          for (const el of progressElements) {
            // Look for style with width as percentage
            const style = window.getComputedStyle(el);
            if (style.width && style.width.includes('%')) {
              goal.progress = parseFloat(style.width);
              console.log('Goal progress from style:', goal.progress);
              if (goal.progress >= 95) goal.completed = true;
              break;
            }
            
            // Look for aria-valuenow attribute
            const valueNow = el.getAttribute('aria-valuenow');
            if (valueNow) {
              goal.progress = parseFloat(valueNow);
              console.log('Goal progress from aria-valuenow:', goal.progress);
              if (goal.progress >= 95) goal.completed = true;
              break;
            }
          }
          
          // Look for goal text nearby
          const goalTextElements = document.querySelectorAll('[class*="goal"] div, [class*="Goal"] div');
          for (const el of goalTextElements) {
            if (el.innerText && el.innerText.length > 3) {
              goal.text = el.innerText.trim();
              console.log('Found goal text:', goal.text);
              break;
            }
          }
          
          // Look for token amount
          const tokenElements = document.querySelectorAll("*");
          for (const el of tokenElements) {
            if (el.innerText && el.innerText.includes('tk')) {
              const match = el.innerText.match(/(\d+)\s*tk/);
              if (match && match[1]) {
                goal.currentAmount = parseInt(match[1], 10);
                console.log('Found token amount:', goal.currentAmount);
                break;
              }
            }
          }
        }
        
        return goal;
      });
      
      console.log(`Goal information for ${username}:`, goalInfo);
      
      // Update result with goal data
      result.goal = goalInfo;
    } else {
      console.log(`${username} is OFFLINE`);
    }

    // Close the page and release the browser
    await page.close();
    browserService.releaseBrowser(browser);
    
    return result;
    
  } catch (error) {
    console.error(`❌ Error checking status for ${username}:`, error);
    if (page) {
      try { await page.close(); } catch (e) {}
    }
    if (browser) {
      browserService.releaseBrowser(browser);
    }
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
        const progressPercentage = Math.floor(goal.progress);
        text += `\n\n🎯 *Goal Progress:* ${progressPercentage}%`;
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
      
      // Update user data
      user.isLive = isLive;
      user.lastChecked = now.toISOString();
      
      if (goal && goal.active) {
        user.hasGoal = true;
        user.goalProgress = goal.progress;
        user.goalText = goal.text || '';
        user.goalCompleted = goal.completed;
      } else {
        user.hasGoal = false;
        user.goalCompleted = false;
      }
      
      // Notify if status changed
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

  // Regular monitoring every 5 minutes
  monitorInterval = setInterval(async () => {
    console.log("🔍 Running monitoring check...");
    try {
      await performFullStatusCheck(botInstance);
    } catch (error) {
      console.error("❌ Error in monitoring check:", error);
    }
  }, 5 * 60 * 1000); // 5 minutes

  // Goal checking every 30 seconds
  goalCheckInterval = setInterval(async () => {
    try {
      await checkGoalsForAutoRecording(botInstance);
    } catch (error) {
      console.error("❌ Error in goal check:", error);
    }
  }, 30 * 1000); // 30 seconds

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
 * Perform a full status check of all monitored users
 */
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
      
      console.log(`[${now}] 📊 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(monitoredUsers.length/batchSize)}`);
      
      // Process batch in parallel
      await Promise.all(batch.map(async (user) => {
        try {
          console.log(`[${now}] 🔍 Checking: ${user.username} (chatId: ${user.chatId})`);
          const { isLive, goal } = await checkStripchatStatus(user.username);
          
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
      
      // Small delay between batches
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
 */
async function checkGoalsForAutoRecording(botInstance) {
  const now = new Date().toISOString();
  
  try {
    // Get all monitored users
    const monitoredUsers = monitoredUsersModel.getAllMonitoredUsers();
    if (!monitoredUsers || monitoredUsers.length === 0) {
      return;
    }
    
    // Get only users with auto-record enabled
    const usersWithAutoRecord = [];
    for (const user of monitoredUsers) {
      const autoRecordUsers = autoRecordConfigModel.getUsersWithAutoRecordForUsername(user.username, user.chatId);
      if (autoRecordUsers.length > 0) {
        usersWithAutoRecord.push({
          ...user,
          autoRecordUsers
        });
      }
    }
    
    if (usersWithAutoRecord.length === 0) {
      return;
    }
    
    // Process live users for goal completion
    for (const user of usersWithAutoRecord) {
      try {
        // Skip users that aren't live
        if (!user.isLive) continue;
        
        const { username, chatId } = user;
        
        // Fetch fresh goal data
        const { isLive, goal } = await checkStripchatStatus(username);
        
        // Skip if no active goal or user is no longer live
        if (!isLive || !goal || !goal.active) continue;
        
        // Get previous goal state
        const previousGoalCompleted = user.goalCompleted || false;
        
        // Update user data in the main array
        const userIndex = monitoredUsers.findIndex(u => 
          u.username === username && u.chatId === chatId);
        
        if (userIndex !== -1) {
          monitoredUsers[userIndex].hasGoal = true;
          monitoredUsers[userIndex].goalProgress = goal.progress;
          monitoredUsers[userIndex].goalCompleted = goal.completed;
          monitoredUsers[userIndex].goalText = goal.text || '';
          monitoredUsers[userIndex].lastChecked = new Date().toISOString();
        }
        
        // Check if goal has just been completed
        if (goal.completed && !previousGoalCompleted) {
          console.log(`[${now}] 🎉 GOAL COMPLETED for ${username}! Triggering auto-recording...`);
          
          // Update the completed flag
          if (userIndex !== -1) {
            monitoredUsers[userIndex].goalCompleted = true;
          }
          await monitoredUsersModel.saveMonitoredUsers();
          
          // Trigger auto-recording for each eligible user
          for (const eligibleUser of user.autoRecordUsers) {
            try {
              await triggerGoalAutoRecording({
                ...user,
                goalText: goal.text || 'Special Goal',
                goalProgress: goal.progress,
                goalAmount: goal.currentAmount || 0
              }, botInstance, eligibleUser);
            } catch (recordError) {
              console.error(`[${now}] ❌ Error triggering auto-recording:`, recordError);
            }
          }
        }
      } catch (error) {
        console.error(`Error processing goal for ${user.username}:`, error);
      }
    }
    
    // Save the updated goal status information
    await monitoredUsersModel.saveMonitoredUsers();
    
  } catch (error) {
    console.error(`Error in goal check routine:`, error);
  }
}

/**
 * Trigger auto-recording for a completed goal
 */
async function triggerGoalAutoRecording(user, botInstance, eligibleUser) {
  const { username, chatId, goalText, goalProgress, goalAmount } = user;
  
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
    const sanitizedGoalText = goalText
      ? goalText
          .replace(/BRA|bra|👙/g, "👚")
          .replace(/TAKE OFF/g, "OUTFIT")
          .replace(/OFF/g, "")
          .replace(/TAKE/g, "")
          .replace(/🚫|⛔|🔞/g, "")
          .replace(/\s+/g, " ")
          .trim()
      : "Special Goal";
    
    // Notify the user
    await botInstance.telegram.sendMessage(
      chatId,
      `🎉 *${username}* completed their goal!\n\n` +
      `🎯 *Goal:* ${sanitizedGoalText}\n` +
      (goalProgress ? `✅ *Progress:* ${Math.floor(goalProgress)}% complete\n` : '') +
      (goalAmount ? `💰 *Tokens:* ${goalAmount} tk\n\n` : '\n') +
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
      replyWithVideo: (data) => botInstance.telegram.sendVideo(chatId, data.source, 
        data.caption ? { caption: data.caption } : {}),
      telegram: botInstance.telegram
    };
    
    // Execute the recording
    try {
      await recordService.executeRecord(mockCtx, username, duration);
      return true;
    } catch (error) {
      console.error(`Error recording ${username}:`, error);
      
      await botInstance.telegram.sendMessage(
        chatId,
        `⚠️ Failed to record ${username}. The stream may have ended.`,
        { parse_mode: 'Markdown' }
      );
      
      return false;
    }
  } catch (error) {
    console.error(`Error auto-recording ${username}:`, error);
    return false;
  } finally {
    // Always clean up
    memoryService.removeActiveAutoRecording(recordingKey);
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
    clearInterval(goalCheckInterval);
    goalCheckInterval = null;
  }
  console.log('Stopped all monitoring routines');
}

/**
 * Restart monitoring service
 */
function restartMonitoring(botInstance) {
  console.log("🔄 Restarting monitoring service...");
  stopMonitoring();
  
  // Wait a moment to ensure clean shutdown
  setTimeout(() => {
    startMonitoring(botInstance);
  }, 5000);
}

// Export all functions
module.exports = {
  checkStripchatStatus,
  checkUsernameExists,
  checkAndNotify,
  monitorBatch,
  generateProgressBar,
  startMonitoring,
  stopMonitoring,
  performFullStatusCheck,
  checkGoalsForAutoRecording,
  triggerGoalAutoRecording,
  restartMonitoring
};