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

/**
 * Check the live status of a Stripchat username
 * @param {string} username - Stripchat username to check
 * @returns {Promise<Object>} Status information including isLive, thumbnail, and goal data
 */
async function checkStripchatStatus(username) {
  let browser = null;
  let page = null;
  const result = { isLive: false, thumbnail: null, goal: { active: false, completed: false } };

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
    
    // Rotate between different user agents to avoid detection
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
    ];
    const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
    await page.setUserAgent(randomUserAgent);
    
    // Block unnecessary resources for better performance
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      // Let thumbnails through but block other heavy resources
      if (['font', 'media', 'websocket'].includes(resourceType) || 
          (resourceType === 'image' && !req.url().includes('thumb') && !req.url().includes('preview'))) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Set reasonable timeouts
    await page.setDefaultNavigationTimeout(30000);
    
    // Capture page errors and console messages
    page.on('error', err => console.error(`Page error for ${username}:`, err));
    page.on('console', msg => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        console.log(`Console ${msg.type()} from ${username} page:`, msg.text());
      }
    });
    
    // Add cache busting and random parameters
    const cacheBuster = Date.now();
    const randomParams = Math.random().toString(36).substring(2, 15);
    await page.goto(`https://stripchat.com/${username}?_=${cacheBuster}&r=${randomParams}`, {
      waitUntil: 'domcontentloaded', // Changed to load faster
      timeout: 30000
    });

    // REMOVED waitForTimeout - Use a short delay with sleep function instead
    // Use a simple timeout rather than page.waitForTimeout
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check if page redirected to offline page
    const finalUrl = page.url();
    if (finalUrl.includes('/offline') || finalUrl.includes('/track/visit')) {
      console.log(`🔴 ${username} redirected to offline page: ${finalUrl}`);
      await page.close();
      browserService.releaseBrowser(browser);
      return result;
    }

    // Extract all visible text to help with debugging
    const pageText = await page.evaluate(() => document.body.innerText);
    if (pageText.includes('We will be back soon')) {
      console.log(`🛠️ ${username} page shows maintenance message`);
      await page.close();
      browserService.releaseBrowser(browser);
      return result;
    }

    // Look specifically for the green dot that indicates live status
    const hasGreenDot = await page.evaluate(() => {
      // Look for any green circle element
      const greenElements = document.querySelectorAll('*');
      for (const el of greenElements) {
        const style = window.getComputedStyle(el);
        const bgColor = style.backgroundColor;
        const borderColor = style.borderColor;
        const classNames = el.className || '';
        
        // Check for green colors or status-related class names
        if ((bgColor.includes('rgb(0, 255, 0)') || bgColor.includes('rgb(0, 128, 0)') || 
             bgColor.includes('rgb(50, 205, 50)') || bgColor.includes('rgb(34, 139, 34)') ||
             borderColor.includes('rgb(0, 255, 0)') || borderColor.includes('rgb(0, 128, 0)')) &&
            (el.offsetWidth <= 15 && el.offsetHeight <= 15)) {
          return true;
        }

        // Check for status indicator classes
        if ((typeof classNames === 'string') && 
            (classNames.includes('online') || classNames.includes('live') || 
             classNames.includes('active') || classNames.includes('streaming'))) {
          return true;
        }
      }
      return false;
    });

    // Check for specific text patterns that indicate online/offline status
    const onlineIndicators = await page.evaluate(() => {
      // Find all elements with text
      const elements = document.querySelectorAll('body *');
      const matches = {
        online: false,
        offline: false,
        videoPlayer: !!document.querySelector('video'),
        chatActive: false,
        tipButtons: false,
        privateAvailable: false,
        nextBroadcast: false
      };
      
      // Check all elements for indicating text
      Array.from(elements).forEach(el => {
        const text = el.innerText || '';
        if (text.match(/live|online|streaming now/i)) matches.online = true;
        if (text.match(/offline|away|not available|be back soon/i)) matches.offline = true;
        if (text.match(/next broadcast|scheduled for/i)) matches.nextBroadcast = true;
        if (text.match(/chat with|send a message|tip/i)) matches.chatActive = true;
        if (text.match(/private show|go private|exclusive/i)) matches.privateAvailable = true;
      });
      
      // Check for tip/token UI elements
      matches.tipButtons = !!document.querySelector('button[class*="tip"], [class*="Tip"], [class*="token"]');
      
      return matches;
    });

    // Extract detailed goal and tokens information
    const goalData = await page.evaluate(() => {
      // Build goal data with fallbacks
      let goal = {
        active: false,
        completed: false,
        progress: 0,
        totalAmount: 0,
        currentAmount: 0,
        text: ''
      };
      
      // EXTRACT TOKENS - Look for token amounts first (these are easier to identify)
      // Try to find token amounts in the format of "X tk" or "X/Y tk" or "X tokens"
      const tokenTextElements = Array.from(document.querySelectorAll('*')).filter(el => {
        const text = el.innerText || '';
        return text.match(/\d+\s*tk/i) || text.match(/\d+\s*tokens/i) || text.match(/left to reach the goal/i);
      });
      
      // Handle token extraction
      for (const el of tokenTextElements) {
        const text = el.innerText || '';
        
        // Look for "X tk left to reach the goal" pattern
        const leftToReachMatch = text.match(/(\d+(?:,\d+)?)\s*tk\s*left to reach/i);
        if (leftToReachMatch) {
          const leftAmount = parseInt(leftToReachMatch[1].replace(/,/g, ''), 10);
          goal.active = true;
          goal.currentAmount = leftAmount;
          continue;
        }
        
        // Look for "X/Y tk" pattern (current/total)
        const fractionMatch = text.match(/(\d+(?:,\d+)?)\s*\/\s*(\d+(?:,\d+)?)\s*tk/i);
        if (fractionMatch) {
          goal.active = true;
          goal.currentAmount = parseInt(fractionMatch[1].replace(/,/g, ''), 10);
          goal.totalAmount = parseInt(fractionMatch[2].replace(/,/g, ''), 10);
          continue;
        }
        
        // Look for simple "X tk" pattern (could be current amount or remaining)
        const simpleMatch = text.match(/(\d+(?:,\d+)?)\s*tk/i);
        if (simpleMatch && !goal.currentAmount) {
          goal.active = true;
          goal.currentAmount = parseInt(simpleMatch[1].replace(/,/g, ''), 10);
        }
      }
      
      // EXTRACT GOAL TEXT - Now that we have token info, find goal text
      // Strategy: Look for elements near token elements that might contain goal text
      if (goal.active && tokenTextElements.length > 0) {
        // Try to find goal text in parent or nearby elements
        for (const tokenEl of tokenTextElements) {
          let goalTextCandidate = '';
          
          // Check parent elements first (usually goal container)
          let parent = tokenEl.parentElement;
          for (let i = 0; i < 3 && parent; i++) { // Check up to 3 levels up
            const parentText = parent.innerText;
            // Skip if parent just contains the same token text
            if (parentText && parentText.length > tokenEl.innerText.length * 1.5) {
              goalTextCandidate = parentText;
              break;
            }
            parent = parent.parentElement;
          }
          
          // If we found a candidate, clean it
          if (goalTextCandidate) {
            // Remove token info, percentages, and clean up
            goalTextCandidate = goalTextCandidate
              .replace(/\d+\s*tk/gi, '')
              .replace(/\d+\s*\/\s*\d+\s*tk/gi, '')
              .replace(/\d+%/g, '')
              .replace(/left to reach the goal/gi, '')
              .replace(/goal|Goal|Tokens|tokens|tip|Tip|progress/gi, '')
              .replace(/\s+/g, ' ')
              .trim();
            
            if (goalTextCandidate.length > 0) {
              goal.text = goalTextCandidate;
              break;
            }
          }
        }
      }
      
      // EXTRACT GOAL PROGRESS - Look for progress indicators or calculate from tokens
      // Method 1: Look for percentage text
      const percentElements = Array.from(document.querySelectorAll('*')).filter(el => {
        const text = el.innerText || '';
        return text.match(/\d+\s*%/);
      });
      
      if (percentElements.length > 0) {
        const percentMatch = percentElements[0].innerText.match(/(\d+(?:\.\d+)?)\s*%/);
        if (percentMatch) {
          goal.progress = parseFloat(percentMatch[1]);
          goal.active = true;
        }
      }
      
      // Method 2: Look for progress bars indicated by width styles
      if (!goal.progress && goal.active) {
        const progressBars = Array.from(document.querySelectorAll('[style*="width"]')).filter(el => {
          const style = window.getComputedStyle(el);
          // Likely a progress bar if it has partial width and height is small
          return style.width !== '100%' && style.width !== '0%' && 
                 parseFloat(style.height) < 30 && el.closest('[class*="goal"], [class*="progress"]');
        });
        
        if (progressBars.length > 0) {
          const style = window.getComputedStyle(progressBars[0]);
          const widthStr = style.width;
          if (widthStr.endsWith('%')) {
            goal.progress = parseFloat(widthStr);
            goal.active = true;
          } else if (widthStr.endsWith('px') && progressBars[0].parentElement) {
            // Calculate percentage by comparing element width to parent width
            const parentStyle = window.getComputedStyle(progressBars[0].parentElement);
            const elWidth = parseFloat(widthStr);
            const parentWidth = parseFloat(parentStyle.width);
            if (parentWidth > 0) {
              goal.progress = (elWidth / parentWidth) * 100;
              goal.active = true;
            }
          }
        }
      }
      
      // Method 3: Calculate from tokens if we have total and current
      if (!goal.progress && goal.active && goal.totalAmount > 0 && goal.currentAmount > 0) {
        // If currentAmount represents the gap, we need to invert it
        if (goal.totalAmount > goal.currentAmount && goal.text.includes('left')) {
          goal.progress = Math.round(((goal.totalAmount - goal.currentAmount) / goal.totalAmount) * 100);
        } else {
          goal.progress = Math.round((goal.currentAmount / goal.totalAmount) * 100);
        }
      }
      
      // Check if goal is completed
      goal.completed = goal.progress >= 95;
      
      return goal;
    });

    // Extract any image that might be a thumbnail
    const thumbnailUrl = await page.evaluate(() => {
      // Try meta tags first
      const metaImage = document.querySelector('meta[property="og:image"]') || 
                         document.querySelector('meta[name="thumbnail"]') ||
                         document.querySelector('meta[property="og:image:url"]');
      if (metaImage) {
        return metaImage.getAttribute('content');
      }
      
      // Try to find the main stream thumbnail
      const possibleThumbnails = Array.from(document.querySelectorAll('img')).filter(img => {
        const src = img.src || '';
        return (src.includes('thumb') || src.includes('preview') || src.includes('model')) &&
               !src.includes('logo') && !src.includes('icon') && img.width > 100;
      });
      
      if (possibleThumbnails.length > 0) {
        return possibleThumbnails[0].src;
      }
      
      return null;
    });

    // Collect all the signals to make a final determination
    // Use a more sophisticated decision algorithm
    let isLive = false;
    
    // STRICT CHECK: Force offline if certain indicators are present
    const forceOffline = onlineIndicators.offline || onlineIndicators.nextBroadcast || finalUrl.includes('offline');
    
    if (forceOffline) {
      console.log(`🔴 Forcing offline status for ${username} due to specific offline indicators`);
      isLive = false;
    } else {
      // Calculate weighted score
      let liveScore = 0;
      
      // Strong positive indicators
      if (hasGreenDot) liveScore += 5;
      if (onlineIndicators.videoPlayer) liveScore += 4;
      if (onlineIndicators.online) liveScore += 3;
      
      // Medium positive indicators
      if (onlineIndicators.chatActive) liveScore += 2;
      if (onlineIndicators.tipButtons) liveScore += 2;
      if (onlineIndicators.privateAvailable) liveScore += 2;
      
      // Strong negative indicators
      if (onlineIndicators.offline) liveScore -= 5;
      if (onlineIndicators.nextBroadcast) liveScore -= 4;
      
      console.log(`📊 Live score for ${username}: ${liveScore}`);
      
      // The model is live if score is positive
      isLive = liveScore > 0;
    }

    // Close the page and release the browser
    await page.close();
    browserService.releaseBrowser(browser);
    
    // Combine all results
    const finalResult = {
      isLive,
      thumbnail: thumbnailUrl,
      goal: {
        ...goalData,
        // Ensure we have proper defaults for null values
        active: goalData.active || false,
        completed: goalData.completed || false,
        progress: goalData.progress || 0,
        totalAmount: goalData.totalAmount || 0,
        currentAmount: goalData.currentAmount || 0,
        text: goalData.text || ''
      }
    };
    
    // Log final determination
    console.log(`🔍 Status for ${username}: ${isLive ? '🟢 LIVE' : '⚫ OFFLINE'}, Goal active: ${finalResult.goal.active}`);
    if (finalResult.goal.active) {
      console.log(`🎯 Goal info for ${username}: ${finalResult.goal.progress}% complete, ${finalResult.goal.currentAmount} tokens, Text: "${finalResult.goal.text}"`);
    }
    
    return finalResult;
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
/**
 * Check goals for live streamers and trigger auto-recording with improved accuracy
 * @param {Object} botInstance - Telegram bot instance for notifications
 */
/**
 * Check goals for live streamers and trigger auto-recording with improved accuracy
 * @param {Object} botInstance - Telegram bot instance for notifications
 */
async function checkGoalsForAutoRecording(botInstance) {
    const now = new Date().toISOString();
    console.log(`[${now}] 🎯 Running goal check for auto-recording...`);
    
    try {
        // Get all monitored users
        const monitoredUsers = monitoredUsersModel.getAllMonitoredUsers();
        if (!monitoredUsers || monitoredUsers.length === 0) {
            console.log(`[${now}] ℹ️ No monitored users found, skipping goal check.`);
            return;
        }
        
        // Get only users with auto-record enabled for efficiency
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
            console.log(`[${now}] ℹ️ No users with auto-record enabled, skipping goal check.`);
            return;
        }
        
        console.log(`[${now}] 🎯 Found ${usersWithAutoRecord.length} users with auto-record enabled`);
        
        // First, check which users are currently known to be live
        let liveUsers = usersWithAutoRecord.filter(user => user.isLive);
        console.log(`[${now}] 📺 ${liveUsers.length} users are currently marked as live`);
        
        // If none are known to be live, check a subset to see if any might be live now
        if (liveUsers.length === 0) {
            console.log(`[${now}] 🔍 No known live users, checking for any newly live users...`);
            
            // Select a random subset of users to check (max 3) to avoid overloading
            const candidatesToCheck = usersWithAutoRecord.length <= 3 ? 
                [...usersWithAutoRecord] : 
                usersWithAutoRecord
                    .sort(() => 0.5 - Math.random()) // Shuffle
                    .slice(0, 3); // Take 3 random users
            
            // Check if any of these users are now live
            for (const user of candidatesToCheck) {
                try {
                    console.log(`[${now}] 🔍 Quick checking if ${user.username} is live...`);
                    const status = await checkStripchatStatus(user.username);
                    
                    // Update user status in our local data
                    user.isLive = status.isLive;
                    user.lastChecked = new Date().toISOString();
                    
                    if (status.isLive) {
                        console.log(`[${now}] 🟢 ${user.username} is now LIVE - adding to goal check list`);
                        liveUsers.push({
                            ...user,
                            currentStatus: status
                        });
                        
                        // Also update in the main users array
                        const mainUserIndex = monitoredUsers.findIndex(u => 
                            u.username === user.username && u.chatId === user.chatId);
                        if (mainUserIndex !== -1) {
                            monitoredUsers[mainUserIndex].isLive = true;
                            monitoredUsers[mainUserIndex].lastChecked = new Date().toISOString();
                        }
                    } else {
                        console.log(`[${now}] ⚫ ${user.username} is still OFFLINE`);
                    }
                    
                    // Small delay between checks using standard setTimeout (not page.waitForTimeout)
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (error) {
                    console.error(`[${now}] ❌ Error checking live status for ${user.username}:`, error);
                }
            }
            
            // Save updated user statuses
            await monitoredUsersModel.saveMonitoredUsers();
        }
        
        // If we still have no live users, just exit
        if (liveUsers.length === 0) {
            console.log(`[${now}] ℹ️ No live users found for goal checking.`);
            return;
        }
        
        // Process each live user for goal completion
        console.log(`[${now}] 🎯 Checking goals for ${liveUsers.length} live users with auto-record...`);
        
        for (const user of liveUsers) {
            try {
                const { username, chatId } = user;
                let goal;
                
                // Fetch fresh goal data every time for accuracy
                console.log(`[${now}] 🔄 Fetching fresh goal data for ${username}`);
                const status = await checkStripchatStatus(username);
                
                // If user is no longer live, skip goal processing
                if (!status.isLive) {
                    console.log(`[${now}] ⚫ ${username} is no longer live, skipping goal check`);
                    
                    // Update user status
                    const userIndex = monitoredUsers.findIndex(u => 
                        u.username === username && u.chatId === chatId);
                    if (userIndex !== -1) {
                        monitoredUsers[userIndex].isLive = false;
                        monitoredUsers[userIndex].lastChecked = new Date().toISOString();
                    }
                    
                    continue;
                }
                
                goal = status.goal;
                
                // If no active goal, skip further processing
                if (!goal || !goal.active) {
                    console.log(`[${now}] ⚠️ No active goal for ${username}`);
                    continue;
                }
                
                // Get previous goal state for comparison
                const previousGoalCompleted = user.lastGoalCompleted || false;
                const previousGoalProgress = user.goalProgress || 0;
                
                // Update goal information in the main users array
                const userIndex = monitoredUsers.findIndex(u => 
                    u.username === username && u.chatId === chatId);
                if (userIndex !== -1) {
                    monitoredUsers[userIndex].hasGoal = true;
                    monitoredUsers[userIndex].goalProgress = goal.progress;
                    monitoredUsers[userIndex].goalCompleted = goal.completed;
                    monitoredUsers[userIndex].goalText = goal.text || 'Special Goal';
                    monitoredUsers[userIndex].goalAmount = goal.currentAmount || 0;
                    monitoredUsers[userIndex].lastChecked = new Date().toISOString();
                }
                
                console.log(`[${now}] 📊 ${username} goal: ${goal.progress}% complete (previous: ${previousGoalProgress}%), completed: ${goal.completed}`);
                
                // Check if goal has just been completed
                if (goal.completed && !previousGoalCompleted) {
                    console.log(`[${now}] 🎉 GOAL COMPLETED for ${username}! Triggering auto-recording...`);
                    
                    // Get eligible users for this specific streamer/chat
                    const { autoRecordUsers } = user;
                    console.log(`[${now}] ✓ Found ${autoRecordUsers.length} eligible users for auto-recording ${username}`);
                    
                    // Update the completed flag first to avoid duplicate recordings
                    if (userIndex !== -1) {
                        monitoredUsers[userIndex].lastGoalCompleted = true;
                    }
                    await monitoredUsersModel.saveMonitoredUsers();
                    
                    // Trigger auto-recording for each eligible user
                    for (const eligibleUser of autoRecordUsers) {
                        try {
                            console.log(`[${now}] 🎬 Auto-recording for user ID ${eligibleUser.userId}, duration: ${eligibleUser.duration}s`);
                            await triggerGoalAutoRecording({
                                ...user,
                                goalText: goal.text || 'Special Goal',
                                goalProgress: goal.progress,
                                goalAmount: goal.currentAmount
                            }, botInstance, eligibleUser);
                        } catch (recordError) {
                            console.error(`[${now}] ❌ Error triggering auto-recording for ${username}:`, recordError);
                        }
                    }
                } else if (!goal.completed && previousGoalCompleted) {
                    // Goal was reset
                    console.log(`[${now}] 🔄 Goal for ${username} was reset or started over`);
                    if (userIndex !== -1) {
                        monitoredUsers[userIndex].lastGoalCompleted = false;
                    }
                }
                
                // Small delay between users using standard Promise.setTimeout (not page.waitForTimeout)
                await new Promise(resolve => setTimeout(resolve, 1000));
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
 * Trigger auto-recording for a completed goal with improved reliability
 * @param {Object} user - User object with details
 * @param {Object} botInstance - Telegram bot instance
 * @param {Object} eligibleUser - User eligible for auto-recording
 * @returns {Promise<boolean>} Success status
 */
async function triggerGoalAutoRecording(user, botInstance, eligibleUser) {
    const { username, chatId, goalText, goalProgress, goalAmount } = user;
    
    // Check if already recording
    if (memoryService.isAutoRecordingActive(chatId, username)) {
        console.log(`⚠️ Already auto-recording ${username}, skipping duplicate recording`);
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
        
        // Execute the recording with multiple attempts if needed
        let recordingSuccess = false;
        let attempts = 0;
        const maxAttempts = 2; // Try up to 2 times
        
        while (!recordingSuccess && attempts < maxAttempts) {
            attempts++;
            try {
                // Execute the recording
                const recordService = require('./recordService');
                recordingSuccess = await recordService.executeRecord(mockCtx, username, duration);
                
                if (!recordingSuccess && attempts < maxAttempts) {
                    console.log(`⚠️ Recording attempt ${attempts} failed for ${username}, retrying...`);
                    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait before retry
                }
            } catch (error) {
                console.error(`❌ Recording attempt ${attempts} failed with error:`, error);
                if (attempts < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait before retry
                }
            }
        }
        
        if (!recordingSuccess) {
            await botInstance.telegram.sendMessage(
                chatId,
                `⚠️ Failed to record ${username} after multiple attempts. The stream may have ended or changed format.`,
                { parse_mode: 'Markdown' }
            );
        }
        
        return recordingSuccess;
    } catch (error) {
        console.error(`❌ Error auto-recording ${username}:`, error);
        return false;
    } finally {
        // Always clean up regardless of success/failure
        memoryService.removeActiveAutoRecording(recordingKey);
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