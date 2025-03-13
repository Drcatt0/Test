/**
 * Enhanced Notifier Service
 * A more reliable system for monitoring streamers and sending notifications
 * Updated with 5-minute check interval
 */
const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');
const monitoredUsersModel = require('../models/monitoredUsers');
const autoRecordConfigModel = require('../models/autoRecordConfig');
const recordService = require('./recordService');
const memoryService = require('./memoryService');
const browserService = require('./browserService');
const goalMonitorService = require('./goalMonitorService');
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

  // Start stream check interval (every 5 minutes as requested)
  streamCheckInterval = setInterval(async () => {
    const now = new Date();
    console.log(`🔍 [${now.toISOString()}] Running stream status check (every 5 minutes)...`);
    try {
      await checkAllStreamers(botInstance);
    } catch (error) {
      console.error("❌ Error in stream status check:", error);
    }
  }, 5 * 60 * 1000); // 5 minutes as requested
  
  // Start recovery interval (every 10 minutes)
  recoveryInterval = setInterval(async () => {
    console.log("🔄 Running recovery check...");
    try {
      await performRecoveryCheck();
    } catch (error) {
      console.error("❌ Error in recovery check:", error);
    }
  }, 10 * 60 * 1000);

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
 * Check all monitored streamers
 */
async function checkAllStreamers(botInstance) {
  const monitoredUsers = monitoredUsersModel.getAllMonitoredUsers();
  if (monitoredUsers.length === 0) {
    return;
  }
  
  console.log(`📡 Checking ${monitoredUsers.length} monitored streamers...`);
  
  // Group users by username to avoid duplicate checks
  const usernameGroups = {};
  monitoredUsers.forEach(user => {
    const username = user.username.toLowerCase();
    if (!usernameGroups[username]) {
      usernameGroups[username] = [];
    }
    usernameGroups[username].push(user);
  });
  
  // Process usernames in batches to avoid overwhelming the system
  const batchSize = 5;
  const usernames = Object.keys(usernameGroups);
  
  for (let i = 0; i < usernames.length; i += batchSize) {
    const batch = usernames.slice(i, i + batchSize);
    
    // Process batch in parallel
    await Promise.all(batch.map(async (username) => {
      try {
        const users = usernameGroups[username];
        await checkStreamerStatus(username, users, botInstance);
      } catch (error) {
        console.error(`Error checking ${username}:`, error);
        
        // Increment failed check counter
        const failCount = (failedChecks.get(username) || 0) + 1;
        failedChecks.set(username, failCount);
      }
    }));
    
    // Small delay between batches
    if (i + batchSize < usernames.length) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

/**
 * Check the status of a streamer
 */
async function checkStreamerStatus(username, users, botInstance) {
  try {
    // Get previous status
    const prevStatus = streamStatus.get(username) || { isLive: false };
    
    // Use goalMonitorService.getStreamStatus if available for more accurate status
    let status;
    const isMonitored = goalMonitorService.activeGoalMonitors.has(username.toLowerCase());
    
    if (isMonitored) {
      // Use the more accurate goalMonitorService
      status = await goalMonitorService.getStreamStatus(username);
      
      // Log that we're using goal monitor
      console.log(`Using goal monitor status for ${username}: Live=${status.isLive}`);
    } else {
      // Get current status using our own method
      status = await getStreamerStatus(username);
    }
    
    // Update status in our tracking
    streamStatus.set(username, status);
    
    // Reset failed checks counter
    failedChecks.set(username, 0);
    
    // Check if status changed
    if (status.isLive !== prevStatus.isLive) {
      console.log(`Status change for ${username}: ${prevStatus.isLive ? 'Live→Offline' : 'Offline→Live'}`);
      
      // Send notifications to all users monitoring this streamer
      for (const user of users) {
        try {
          await sendStatusNotification(username, status, user.chatId, botInstance);
          
          // Update user status in model
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
        } catch (notifyError) {
          console.error(`Error notifying chat ${user.chatId} about ${username}:`, notifyError);
        }
      }
    }
    
    // Update all users in the model
    for (const user of users) {
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
    throw error;
  }
}

/**
 * Get the status of a streamer
 */
async function getStreamerStatus(username) {
  let browser = null;
  let page = null;
  
  try {
    // Get browser instance
    browser = await browserService.getBrowser();
    if (!browser) {
      throw new Error(`Failed to get browser instance for ${username}`);
    }

    // Create a new page
    page = await browser.newPage();
    
    // Set random user agent
    await page.setUserAgent(browserService.getRandomUserAgent());
    
    // Block unnecessary resources
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
    
    // Navigate to the user's page with cache buster
    const cacheBuster = Date.now();
    await page.goto(`https://stripchat.com/${username}?_=${cacheBuster}`, {
      waitUntil: 'domcontentloaded',  // Faster load time
      timeout: 25000
    });

    // Wait for essential content (same as in goalMonitorService)
    await page.waitForFunction(
      () => {
        // Check for live elements
        const liveBadge = document.querySelector('.live-badge, [class*="live-badge"]');
        const video = document.querySelector('video');
        // Check for goal elements
        const goalElem = document.querySelector('[class*="epic-goal-progress"], [class*="goal"], [role="progressbar"]');
        
        return (liveBadge !== null) || (video !== null) || (goalElem !== null);
      },
      { timeout: 10000 }
    ).catch(() => {
      console.log(`Timeout waiting for content on ${username}'s page`);
    });

    // Extract status information (same reliable approach as in goalMonitorService)
    const status = await page.evaluate(() => {
      const result = {
        isLive: false,
        goal: {
          active: false,
          progress: 0,
          text: '',
          completed: false,
          tokenAmount: 0
        },
        nextBroadcast: null
      };
      
      // Multiple robust checks for live status
      const videoElem = document.querySelector('video');
      const videoPlaying = videoElem && (videoElem.readyState > 0);
      
      const liveBadge = document.querySelector('.live-badge, [class*="live-badge"]');
      const statusText = document.querySelector('[class*="status"]')?.innerText || '';
      const isStatusLive = statusText.includes('LIVE') || statusText.includes('Live');
      
      const liveBroadcast = document.querySelector('[class*="live"], [class*="broadcast"], [class*="streaming"]');
      
      // Very reliable live detection combining multiple methods
      result.isLive = videoPlaying || 
                     (liveBadge !== null) || 
                     isStatusLive || 
                     (liveBroadcast !== null);
      
      // If not live, try to get next broadcast time
      if (!result.isLive) {
        const scheduleElements = document.querySelectorAll('.schedule-next-informer__weekday, .schedule-next-informer__link, [class*="schedule-next"], [class*="next-show"]');
        if (scheduleElements.length > 0) {
          let nextBroadcast = '';
          scheduleElements.forEach(el => {
            const text = el.textContent.trim();
            if (text) nextBroadcast += text + ' ';
          });
          
          // Try to find the time as well
          const timeElements = document.querySelectorAll(
            '.schedule-next-informer, [class*="schedule-next"], [class*="broadcast-time"]'
          );
          
          timeElements.forEach(el => {
            const text = el.textContent.trim();
            if (text && (text.includes('AM') || text.includes('PM') || text.includes(':'))) {
              nextBroadcast += text + ' ';
            }
          });
          
          result.nextBroadcast = nextBroadcast.trim().replace(/\s+/g, ' ');
        }
      }
      
      // If live, extract goal information
      if (result.isLive) {
        try {
          // Look for goal progress elements (multi-selector for different page versions)
          const goalProgressElements = document.querySelectorAll(
            '[class*="epic-goal-progress"], ' + 
            '[class*="goal-progress"], ' + 
            '[role="progressbar"], ' +
            '[class*="progressbar"], ' +
            '[class*="progress_inner"]'
          );
          
          if (goalProgressElements.length > 0) {
            result.goal.active = true;
            
            // Try multiple methods to get progress percentage
            for (const el of goalProgressElements) {
              // Method 1: From style width
              const style = window.getComputedStyle(el);
              if (style.width && style.width.includes('%')) {
                result.goal.progress = parseFloat(style.width);
                break;
              }
              
              // Method 2: From aria attributes
              const valueNow = el.getAttribute('aria-valuenow');
              if (valueNow) {
                result.goal.progress = parseFloat(valueNow);
                break;
              }
              
              // Method 3: From data attributes
              const dataValue = el.getAttribute('data-progress') || el.getAttribute('data-value');
              if (dataValue) {
                result.goal.progress = parseFloat(dataValue);
                break;
              }
              
              // Method 4: From explicit percentage text
              const progressText = el.textContent || '';
              const percentMatch = progressText.match(/(\d+(\.\d+)?)%/);
              if (percentMatch && percentMatch[1]) {
                result.goal.progress = parseFloat(percentMatch[1]);
                break;
              }
            }
            
            // Alternative progress detection from status element
            if (!result.goal.progress) {
              const statusElements = document.querySelectorAll(
                '[class*="epic-goal-progress_status"], ' +
                '[class*="progress_status"], ' +
                '[class*="percentage"], ' +
                '[class*="progress-value"]'
              );
              
              for (const el of statusElements) {
                const text = el.textContent || '';
                const percentMatch = text.match(/(\d+(\.\d+)?)%/);
                if (percentMatch && percentMatch[1]) {
                  result.goal.progress = parseFloat(percentMatch[1]);
                  break;
                }
              }
            }
            
            // Get token amount (try multiple selectors)
            const tokenElements = document.querySelectorAll(
              '[class*="epic-goal-progress_tokens"], ' +
              '[class*="progress_tokens"], ' +
              '[class*="tokens"], ' +
              '[class*="goal-amount"]'
            );
            
            for (const el of tokenElements) {
              const text = el.textContent || '';
              const tokenMatch = text.match(/(\d+)\s*tk/);
              if (tokenMatch && tokenMatch[1]) {
                result.goal.tokenAmount = parseInt(tokenMatch[1], 10);
                break;
              }
            }
            
            // Get goal text (try multiple methods)
            // Method 1: From dedicated goal info elements
            const goalInfoElements = document.querySelectorAll(
              '[class*="epic-goal-progress_information"], ' +
              '[class*="progress_information"], ' +
              '[class*="information"], ' +
              '[class*="goal-text"], ' +
              '[class*="goal-description"]'
            );
            
            for (const el of goalInfoElements) {
              const text = el.innerText.trim();
              if (text && text.length > 3) {
                result.goal.text = text;
                break;
              }
            }
            
            // Method 2: Look for text with "Goal:" prefix
            if (!result.goal.text) {
              const allElements = document.querySelectorAll('*');
              for (const el of allElements) {
                const text = el.innerText || '';
                if (text.includes('Goal:') || text.includes('goal:')) {
                  result.goal.text = text.trim();
                  break;
                }
              }
            }
            
            // Check if goal is completed
            result.goal.completed = result.goal.progress >= 95;
          }
        } catch (e) {
          console.error("Error extracting goal info:", e);
        }
      }
      
      return result;
    });

    await page.close();
    browserService.releaseBrowser(browser);
    
    return status;
    
  } catch (error) {
    console.error(`Error getting status for ${username}:`, error);
    if (page) {
      try { await page.close(); } catch (e) {}
    }
    if (browser) {
      browserService.releaseBrowser(browser);
    }
    
    // Return default offline status on error
    return { 
      isLive: false, 
      goal: { active: false, progress: 0, text: '', completed: false, tokenAmount: 0 },
      nextBroadcast: null
    };
  }
}

/**
 * Send a status notification for a streamer
 */
async function sendStatusNotification(username, status, chatId, botInstance) {
  try {
    // Create notification key to avoid duplicate notifications
    const notificationKey = `${username}_${chatId}_${status.isLive ? 'live' : 'offline'}`;
    
    // Check if we've sent this notification recently
    const lastTime = lastNotifications.get(notificationKey);
    if (lastTime && Date.now() - lastTime < 60 * 60 * 1000) { // 1 hour cooldown
      return false;
    }
    
    // Prepare the message
    let message = '';
    
    if (status.isLive) {
      message = `🔴 *${username}* is now live! [Watch here](https://stripchat.com/${username})`;
      
      if (status.goal && status.goal.active) {
        const progressPercentage = Math.floor(status.goal.progress);
        const progressBar = generateProgressBar(progressPercentage);
        
        message += `\n\n🎯 *Goal Progress:* ${progressBar} ${progressPercentage}%`;
        
        if (status.goal.text) {
          message += `\n*Goal:* ${status.goal.text}`;
        }
      }
    } else {
      message = `⚫ *${username}* is no longer live.`;
      
      if (status.nextBroadcast) {
        message += `\n\n📆 *Next scheduled broadcast:*\n${status.nextBroadcast}`;
      }
    }
    
    // Send the notification
    if (status.isLive && status.thumbnail) {
      await botInstance.telegram.sendPhoto(chatId, status.thumbnail, {
        caption: message,
        parse_mode: 'Markdown'
      });
    } else {
      await botInstance.telegram.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        disable_web_page_preview: false
      });
    }
    
    // Record the notification time
    lastNotifications.set(notificationKey, Date.now());
    
    return true;
  } catch (error) {
    console.error(`Error sending notification for ${username} to ${chatId}:`, error);
    return false;
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
  checkAllStreamers
};