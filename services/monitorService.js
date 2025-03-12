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

// Browser management
let sharedBrowser = null;
let lastBrowserActivity = Date.now();
let browserInUse = false;

// Monitoring intervals
let monitorInterval = null;

/**
 * Initialize and manage a shared browser instance
 */
async function getBrowser() {
  try {
    // Check if browser exists and is still connected
    if (sharedBrowser && sharedBrowser.connected) {
      // Check if browser has been inactive for too long
      if (!browserInUse && Date.now() - lastBrowserActivity > 5 * 60 * 1000) {
        // Close the browser if it's been inactive for over 5 minutes
        try {
          await sharedBrowser.close();
          sharedBrowser = null;
          console.log("Closed inactive browser to save memory");
        } catch (e) {
          console.error("Error closing inactive browser:", e);
          sharedBrowser = null;
        }
      }
    }
    
    // Launch new browser if needed
    if (!sharedBrowser) {
      sharedBrowser = await puppeteer.launch({
        executablePath: '/usr/bin/chromium-browser',
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--js-flags=--max-old-space-size=256' // Limit JS heap size
        ],
        defaultViewport: { width: 1280, height: 720 }
      });
      
      // Set up close handler to clean up sharedBrowser reference
      sharedBrowser.on('disconnected', () => {
        sharedBrowser = null;
        console.log('Browser disconnected');
      });
    }
    
    browserInUse = true;
    lastBrowserActivity = Date.now();
    return sharedBrowser;
  } catch (error) {
    console.error("Error launching browser:", error);
    sharedBrowser = null;
    throw error;
  }
}

/**
 * Release the browser when done
 */
function releaseBrowser() {
  browserInUse = false;
  lastBrowserActivity = Date.now();
}

/**
 * Check if a username exists on Stripchat
 * @param {string} username - Username to check
 * @returns {Promise<boolean>} True if username exists
 */
async function checkUsernameExists(username) {
  try {
    // Use the existing checkStripchatStatus function to check if the username exists
    // This avoids duplicating browser handling code
    const browser = await getBrowser();
    const page = await browser.newPage();
    
    try {
      // Set a reasonable timeout
      await page.setDefaultNavigationTimeout(30000);
      
      // Navigate to the page
      const response = await page.goto(`https://stripchat.com/${username}`, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      // Check if we got a valid response
      const exists = response.status() === 200;
      
      // Clean up
      await page.close();
      releaseBrowser();
      
      return exists;
    } catch (error) {
      console.error(`Error checking if ${username} exists:`, error);
      
      // Clean up on error
      await page.close();
      releaseBrowser();
      
      return false;
    }
  } catch (error) {
    console.error(`Error launching browser to check if ${username} exists:`, error);
    releaseBrowser();
    return false;
  }
}

/**
 * Enhanced checkStripchatStatus with goal detection and memory optimization
 */
// In services/monitorService.js, update the checkStripchatStatus function to better extract goal information

async function checkStripchatStatus(username) {
  let page = null;
  const result = { isLive: false, thumbnail: null, goal: { active: false, completed: false } };
  
  try {
    // Use shared browser for memory efficiency
    const browser = await getBrowser();
    page = await browser.newPage();
    
    // Limit page resources to save memory
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      // Block unnecessary resources
      if (['image', 'font', 'media'].includes(resourceType) && !req.url().includes('thumbnail')) {
        req.abort();
      } else {
        req.continue();
      }
    });
    
    // Set a reasonable timeout
    await page.setDefaultNavigationTimeout(30000);
    
    // Navigate to the page
    await page.goto(`https://stripchat.com/${username}`, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // Extract info from the page
    const pageData = await page.evaluate(() => {
      const liveBadge = document.querySelector(".live-badge");
      const liveStream = document.querySelector("video");
      const liveStatusText = document.querySelector(".status")?.innerText.includes("Live");
      const thumb = document.querySelector('meta[property="og:image"]')?.content;
      
      // Goal detection - improved based on the screenshots
      let goal = {
        active: false,
        completed: false,
        progress: 0,
        totalAmount: 0,
        currentAmount: 0,
        text: ''
      };
      
      // Check for goal elements using classes from the screenshots
      const goalElements = [
        document.querySelector('.epic-goal-progress_information'),
        document.querySelector('[class*="epic-goal-progress"]'),
        document.querySelector('.goal-widget'),
        document.querySelector('.goal'),
        document.querySelector('[data-test="goal-container"]'),
        document.querySelector('[data-test="goal-widget"]'),
        ...Array.from(document.querySelectorAll('[class*="goal"]')).filter(el => 
          el.innerHTML.includes('progress') || 
          el.innerHTML.includes('bar') || 
          el.innerHTML.includes('%') ||
          el.innerHTML.includes('tk')
        )
      ].filter(Boolean);
      
      if (goalElements.length > 0) {
        // Use the first goal element found
        const goalElement = goalElements[0];
        goal.active = true;
        
        // Look for progress percentage
        const progressElements = [
          document.querySelector('.epic-goal-progress_status'),
          goalElement.querySelector('[class*="progress_status"]'),
          goalElement.querySelector('.progress-bar'),
          goalElement.querySelector('[class*="progress"]'),
          goalElement.querySelector('[style*="width"]'),
          ...Array.from(goalElement.querySelectorAll('*')).filter(el => 
            (el.textContent && el.textContent.includes('%')) ||
            (el.style && el.style.width && el.style.width.includes('%'))
          )
        ].filter(Boolean);
        
        if (progressElements.length > 0) {
          const progressEl = progressElements[0];
          // Try to get progress from text content first (e.g., "78.3%")
          if (progressEl.textContent && progressEl.textContent.includes('%')) {
            const progressMatch = progressEl.textContent.match(/(\d+(?:\.\d+)?)\s*%/);
            if (progressMatch) {
              goal.progress = parseFloat(progressMatch[1]);
            }
          } else if (progressEl.style && progressEl.style.width && progressEl.style.width.includes('%')) {
            goal.progress = parseFloat(progressEl.style.width);
          } else {
            const ariaValue = progressEl.getAttribute('aria-valuenow');
            if (ariaValue) {
              goal.progress = parseFloat(ariaValue);
            }
          }
        }
        
        // Extract token information
        const tokenElements = [
          document.querySelector('.epic-goal-progress_tokens'),
          goalElement.querySelector('[class*="tokens"]'),
          ...Array.from(goalElement.querySelectorAll('*')).filter(el => 
            el.textContent && el.textContent.includes('tk')
          )
        ].filter(Boolean);
        
        if (tokenElements.length > 0) {
          const tokenEl = tokenElements[0];
          const tokenMatch = tokenEl.textContent.match(/(\d+)\s*tk/i);
          if (tokenMatch) {
            goal.currentAmount = parseInt(tokenMatch[1], 10);
          }
        }
        
        // Try to extract goal text
        const textElements = [
          goalElement.querySelector('[class*="epic-goal-progress_information"] span:not([class*="tokens"])'),
          goalElement.querySelector('.goal-text'),
          goalElement.querySelector('.title'),
          goalElement.querySelector('h3'),
          goalElement.querySelector('[class*="title"]'),
          ...Array.from(goalElement.querySelectorAll('span')).filter(el => 
            el.innerText && el.innerText.length > 2 && 
            !el.innerText.includes('%') && 
            !el.innerText.match(/^\d+\s*tk$/i) &&
            !el.innerText.includes('Goal:')
          )
        ].filter(Boolean);
        
        if (textElements.length > 0) {
          // Find the best text element (the one with actual content)
          let bestTextElement = null;
          for (const el of textElements) {
            const text = el.innerText.trim();
            if (text && text.length > 2 && !text.match(/^\d+(\.\d+)?%$/) && !text.match(/^Goal:$/i)) {
              bestTextElement = el;
              break;
            }
          }
          
          if (bestTextElement) {
            goal.text = bestTextElement.innerText.trim();
          }
        }
        
        // Check if completed based on progress
        goal.completed = goal.progress >= 99; // Consider anything ≥99% as completed
      }
      
      return {
        isLive: liveBadge !== null || liveStream !== null || liveStatusText === true,
        thumbnail: thumb || null,
        goal: goal
      };
    });
    
    // Clean up
    await page.close();
    releaseBrowser();
    
    return pageData;
  } catch (error) {
    console.error(`Error checking status for ${username}:`, error);
    if (page) {
      try {
        await page.close();
      } catch (e) {}
    }
    releaseBrowser();
    return result;
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
 * Check and notify about streamer status
 */
async function checkAndNotify(username, chatId, botOrCtx) {
  try {
    const { isLive, thumbnail, goal } = await checkStripchatStatus(username);
    const now = new Date();

    let text = `📢 *${username}* is not live right now.`;
    if (isLive) {
      text = `🔴 *${username}* is currently live! [Watch here](https://stripchat.com/${username})`;
      
      // Add goal info if available
      if (goal && goal.active) {
        text += `\n\n🎯 *Goal Progress:* ${Math.floor(goal.progress)}%`;
        if (goal.text) {
          text += `\n*Goal:* ${goal.text}`;
        }
      }
    }

    try {
      // Handle different types of bot instances
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
 * Monitor a batch of streamers
 */
async function monitorBatch(batch, botInstance) {
  const results = [];
  
  for (const user of batch) {
    try {
      const { username, chatId, isLive: oldLive } = user;
      
      // Check status with goal detection
      const { isLive, thumbnail, goal } = await checkStripchatStatus(username);
      const now = new Date();
      
      // Store previous goal state
      const previousGoalCompleted = user.lastGoalCompleted || false;
      
      // Update user information
      user.isLive = isLive;
      user.lastChecked = now.toISOString();
      
      // Process goal information
      if (goal && goal.active) {
        user.hasGoal = true;
        user.goalProgress = goal.progress;
        user.goalText = goal.text || '';
        user.goalCompleted = goal.completed;
        
        // If goal just completed and streamer is live, trigger auto-recording
        if (goal.completed && !previousGoalCompleted && isLive) {
          user.lastGoalCompleted = true;
          
          // Trigger auto-recording would go here in the full implementation
          // This is handled separately in your module structure
        } else {
          user.lastGoalCompleted = goal.completed;
        }
      } else {
        user.hasGoal = false;
        user.lastGoalCompleted = false;
      }
      
      // Notify about status changes
      if (isLive !== oldLive) {
        let text = `📢 *${username}* is no longer live.`;
        if (isLive) {
          text = `🔴 *${username}* is now live! [Watch here](https://stripchat.com/${username})`;
          
          // Add goal info if available
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

// In services/monitorService.js, update the startMonitoring function

/**
 * Start the monitoring routine
 * @param {Object} botInstance - Telegram bot instance
 */
async function startMonitoring(botInstance) {
  // First load the user data
  await monitoredUsersModel.loadMonitoredUsers();
  await autoRecordConfigModel.loadAutoRecordConfig();
  
  // Start the monitoring interval
  monitorInterval = setInterval(async () => {
    try {
      const monitoredUsers = monitoredUsersModel.getAllMonitoredUsers();
      
      if (monitoredUsers.length === 0) {
        return; // No users to monitor
      }
      
      console.log(`Checking ${monitoredUsers.length} monitored users...`);
      
      // Process users in batches to prevent memory issues
      const batchSize = 3; // Process 3 at a time
      
      for (let i = 0; i < monitoredUsers.length; i += batchSize) {
        const batch = monitoredUsers.slice(i, i + batchSize);
        
        // Process the batch and get results
        const results = await monitorBatch(batch, botInstance);
        
        // Check for auto-recording triggers (goal completions)
        for (const result of results) {
          if (!result.success) continue;
          
          const user = result.user;
          
          // Debug logging for goal detection
          if (user.hasGoal) {
            console.log(`Goal info for ${user.username}:`, {
              progress: user.goalProgress,
              completed: user.goalCompleted,
              lastCompleted: user.lastGoalCompleted,
              text: user.goalText,
              isLive: user.isLive
            });
          }
          
          // Check if this is a newly completed goal that should trigger auto-recording
          if (user.hasGoal && 
              user.goalCompleted && 
              !user.lastGoalCompleted && 
              user.isLive) {
            
            console.log(`Goal completed for ${user.username}! Checking for auto recording eligibility.`);
            
            // Get users who have auto-recording enabled for this username
            const eligibleUsers = autoRecordConfigModel.getUsersWithAutoRecordForUsername(
              user.username, 
              user.chatId
            );
            
            console.log(`Found ${eligibleUsers.length} eligible users for auto-recording of ${user.username}`);
            
            for (const eligibleUser of eligibleUsers) {
              // Check if already auto-recording
              if (memoryService.isAutoRecordingActive(user.chatId, user.username)) {
                console.log(`Already auto-recording ${user.username}`);
                continue;
              }
              
              // Mark as active to prevent duplicate recordings
              const recordingKey = memoryService.addActiveAutoRecording(
                user.chatId, 
                user.username
              );
              
              // Get duration setting (default to 3 minutes)
              const duration = eligibleUser.duration || 180;
              
              try {
                console.log(`Auto-recording ${user.username} for ${duration} seconds`);
                
                // Send notification
                await botInstance.telegram.sendMessage(
                  user.chatId,
                  `🎉 *${user.username}* completed their goal!\n\n` +
                  `🎯 *Goal:* ${user.goalText || 'No description'}\n\n` +
                  `🎬 *Auto-recording for ${duration} seconds...*`,
                  { parse_mode: 'Markdown' }
                );
                
                // Create a mock context for record service
                const mockCtx = {
                  message: {
                    chat: { id: user.chatId },
                    from: { id: eligibleUser.userId }
                  },
                  reply: (text, options) => botInstance.telegram.sendMessage(
                    user.chatId, text, options
                  ),
                  replyWithVideo: (data) => botInstance.telegram.sendVideo(
                    user.chatId, data.source, { caption: data.caption }
                  ),
                  telegram: botInstance.telegram
                };
                
                // Execute the recording
                await recordService.executeRecord(mockCtx, user.username, duration);
                
              } catch (error) {
                console.error(`Error auto-recording ${user.username}:`, error);
              } finally {
                // Remove from active recordings
                memoryService.removeActiveAutoRecording(recordingKey);
              }
            }
          }
          
          // Update user in the database - make sure to set lastGoalCompleted
          user.lastGoalCompleted = user.goalCompleted;
          
          await monitoredUsersModel.updateUserStatus(
            user.username,
            user.chatId,
            {
              isLive: user.isLive,
              hasGoal: user.hasGoal,
              goalProgress: user.goalProgress,
              goalText: user.goalText,
              goalCompleted: user.goalCompleted,
              lastGoalCompleted: user.lastGoalCompleted
            }
          );
        }
        
        // Small delay between batches to reduce load
        if (i + batchSize < monitoredUsers.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      // Save changes to disk
      await monitoredUsersModel.saveMonitoredUsers();
      
    } catch (error) {
      console.error("Error in monitoring routine:", error);
    }
  }, config.MONITOR_INTERVAL);
  
  console.log('Started monitoring routine');
}
/**
 * Stop the monitoring routine
 */
function stopMonitoring() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log('Stopped monitoring routine');
  }
}

// Export all functions needed by other modules
module.exports = {
  checkStripchatStatus,
  checkUsernameExists,
  checkAndNotify,
  monitorBatch,
  generateProgressBar,
  getBrowser,
  releaseBrowser,
  startMonitoring,
  stopMonitoring
};