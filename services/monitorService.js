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
    // Use the existing checkStripchatStatus function to check if the username exists
    // This avoids duplicating browser handling code
    const browser = await browserService.getBrowser();
    if (!browser) {
      console.error("Failed to get browser to check username");
      return false;
    }
    
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
      browserService.releaseBrowser(browser);
      
      return exists;
    } catch (error) {
      console.error(`Error checking if ${username} exists:`, error);
      
      // Clean up on error
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
 * Updated checkStripchatStatus function with compatibility fix for older Puppeteer
 */

async function checkStripchatStatus(username) {
  let page = null;
  const result = { isLive: false, thumbnail: null, goal: { active: false, completed: false } };
  
  try {
    // Use shared browser for memory efficiency
    const browser = await browserService.getBrowser();
    if (!browser) {
      console.error("Failed to get browser to check status");
      return result;
    }
    
    page = await browser.newPage();
    
    // Limit page resources to save memory, but allow images for thumbnails
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      const url = req.url();
      // Allow thumbnails, block other heavy resources
      if (resourceType === 'media' || 
          (resourceType === 'image' && !url.includes('thumbnail') && !url.includes('preview'))) {
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
    
    // Wait a moment for JavaScript to execute - COMPATIBILITY FIX
    // Replace waitForTimeout with compatible alternative
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 3000)));
    
    // Additional logging for debugging
    console.log(`Checking status for ${username} with enhanced detection...`);
    
    // Try to make screenshots more successful with this
    try {
      await page.evaluate(() => {
        // Try to click on any age verification or consent buttons
        const buttons = Array.from(document.querySelectorAll('button'));
        const ageButtons = buttons.filter(btn => 
          btn.innerText.includes('18') || 
          btn.innerText.includes('ENTER') || 
          btn.innerText.includes('AGREE') ||
          btn.innerText.includes('CONTINUE')
        );
        
        if (ageButtons.length > 0) {
          ageButtons[0].click();
          console.log('Clicked age verification button');
        }
      });
    } catch (e) {
      console.log('No age verification needed or error clicking button', e);
    }
    
    // Extract info from the page with additional console.logs
    const pageData = await page.evaluate(() => {
      console.log('Starting page evaluation for goal detection...');
      
      const liveBadge = document.querySelector(".live-badge");
      const liveStream = document.querySelector("video");
      const liveStatusText = document.querySelector(".status")?.innerText.includes("Live");
      const thumb = document.querySelector('meta[property="og:image"]')?.content;
      
      console.log('Live indicators:', { 
        liveBadge: !!liveBadge, 
        liveStream: !!liveStream, 
        liveStatusText: !!liveStatusText,
        thumbnailFound: !!thumb
      });
      
      // Enhanced goal detection with more selectors and methods
      let goal = {
        active: false,
        completed: false,
        progress: 0,
        totalAmount: 0,
        currentAmount: 0,
        text: ''
      };
      
      // STEP 1: Direct DOM approach - Find all possible goal-related elements
      console.log('Step 1: Searching for goal elements in DOM...');
      
      // Check for goal elements using a wider variety of selectors
      const goalElements = [
        document.querySelector('.epic-goal-progress_information'),
        document.querySelector('[class*="epic-goal-progress"]'),
        document.querySelector('.goal-widget'),
        document.querySelector('.goal'),
        document.querySelector('[data-test="goal-container"]'),
        document.querySelector('[data-test="goal-widget"]'),
        document.querySelector('.sc-goal'),
        document.querySelector('.progress-bar-container'),
        document.querySelector('[class*="sc-border"]'),
        ...Array.from(document.querySelectorAll('[class*="goal"]')),
        ...Array.from(document.querySelectorAll('[class*="progress"]')),
        ...Array.from(document.querySelectorAll('.progress-bar, [class*="progress-bar"]')),
        ...Array.from(document.querySelectorAll('[style*="width"]')).filter(el => 
          el.parentElement && 
          (el.parentElement.className.includes('progress') || el.parentElement.className.includes('bar'))
        )
      ].filter(Boolean);
      
      console.log(`Found ${goalElements.length} potential goal elements`);
      
      // STEP 2: Check for goal data in JavaScript and hardcoded in DOM
      console.log('Step 2: Looking for goal data in scripts...');
      
      // Look for React props and JSON data in scripts
      const scriptData = Array.from(document.querySelectorAll('script'))
        .map(script => script.textContent)
        .filter(content => 
          content.includes('goal') && 
          (content.includes('progress') || content.includes('percent') || content.includes('token'))
        )
        .join('');
      
      // Try to extract JSON data from the page
      let jsonData = '';
      try {
        const jsonMatches = scriptData.match(/(\{.*"goal".*\})/g) || 
                          scriptData.match(/(\{.*"progress".*\})/g) ||
                          scriptData.match(/(\{.*"percent".*\})/g);
        
        if (jsonMatches && jsonMatches.length > 0) {
          jsonData = jsonMatches[0];
          console.log('Found potential JSON goal data');
        }
      } catch (e) {
        console.log('Error parsing JSON data:', e);
      }
      
      // STEP 3: Look for very specific progress indicators
      console.log('Step 3: Searching for specific progress indicators...');
      
      // Direct percentage text anywhere on the page
      const percentageTexts = Array.from(document.querySelectorAll('*'))
        .filter(el => el.textContent && /\d+(\.\d+)?%/.test(el.textContent))
        .map(el => {
          const match = el.textContent.match(/(\d+(?:\.\d+)?)%/);
          return match ? parseFloat(match[1]) : 0;
        })
        .filter(val => val > 0);
      
      if (percentageTexts.length > 0) {
        console.log(`Found ${percentageTexts.length} direct percentage texts:`, percentageTexts);
      }
      
      // Style-based width percentages (progress bars)
      const progressBars = Array.from(document.querySelectorAll('.progress-bar, [class*="progress-bar"], [class*="goal-bar"], [style*="width"]'))
        .filter(el => el.style && el.style.width && el.style.width.includes('%'))
        .map(el => parseFloat(el.style.width))
        .filter(val => !isNaN(val) && val > 0);
      
      if (progressBars.length > 0) {
        console.log(`Found ${progressBars.length} progress bars with width styles:`, progressBars);
      }
      
      // Step 4: If we found any goal elements, try to extract all information
      if (goalElements.length > 0 || percentageTexts.length > 0 || progressBars.length > 0 || jsonData) {
        console.log('Goal appears to be active, extracting details...');
        goal.active = true;
        
        // Try to extract progress percentage from various sources
        if (percentageTexts.length > 0) {
          // Use the first percentage text found
          goal.progress = percentageTexts[0];
          console.log(`Using direct percentage text: ${goal.progress}%`);
        } else if (progressBars.length > 0) {
          // Use the first progress bar width
          goal.progress = progressBars[0];
          console.log(`Using progress bar width: ${goal.progress}%`);
        } else if (jsonData) {
          // Try to extract from JSON data
          try {
            const progressMatch = jsonData.match(/"progress":\s*(\d+(?:\.\d+)?)/);
            const percentMatch = jsonData.match(/"percent":\s*(\d+(?:\.\d+)?)/);
            if (progressMatch || percentMatch) {
              goal.progress = parseFloat(progressMatch?.[1] || percentMatch?.[1] || 0);
              console.log(`Using JSON data progress: ${goal.progress}%`);
            }
          } catch (e) {
            console.log('Error extracting progress from JSON:', e);
          }
        }
        
        // If we still don't have progress, try computed styles
        if (goal.progress === 0 && goalElements.length > 0) {
          try {
            const progressBars = document.querySelectorAll('.progress-bar, [class*="progress-bar"], [class*="goal-bar"]');
            for (const bar of progressBars) {
              try {
                const computedWidth = window.getComputedStyle(bar).width;
                const containerWidth = window.getComputedStyle(bar.parentElement).width;
                
                if (computedWidth && containerWidth) {
                  const widthPx = parseFloat(computedWidth);
                  const containerPx = parseFloat(containerWidth);
                  
                  if (!isNaN(widthPx) && !isNaN(containerPx) && containerPx > 0) {
                    goal.progress = Math.round((widthPx / containerPx) * 100);
                    console.log(`Using computed style ratio: ${goal.progress}%`);
                    break;
                  }
                }
              } catch (e) {
                console.log('Error calculating with computed style:', e);
              }
            }
          } catch (e) {
            console.log('Error in computed style section:', e);
          }
        }
        
        // As a last resort, look for aria values
        if (goal.progress === 0 && goalElements.length > 0) {
          for (const el of goalElements) {
            const ariaValue = el.getAttribute('aria-valuenow');
            if (ariaValue) {
              goal.progress = parseFloat(ariaValue);
              console.log(`Using aria-valuenow: ${goal.progress}`);
              break;
            }
          }
        }
        
        // If all else fails and we have goal elements, assume 50% as default
        if (goal.progress === 0 && goal.active) {
          goal.progress = 50; // Set a default so we show something
          console.log('No specific progress found, using default 50%');
        }
        
        // Try to extract token information
        try {
          const tokenElements = Array.from(document.querySelectorAll('*'))
            .filter(el => el.textContent && /\d+\s*tk/i.test(el.textContent));
          
          if (tokenElements.length > 0) {
            for (const tokenEl of tokenElements) {
              const tokenMatch = tokenEl.textContent.match(/(\d+)\s*tk/i);
              if (tokenMatch) {
                goal.currentAmount = parseInt(tokenMatch[1], 10);
                console.log(`Found token amount: ${goal.currentAmount}`);
                break;
              }
            }
          }
        } catch (e) {
          console.log('Error extracting token info:', e);
        }
        
        // Try to extract goal text
        try {
          // Extract from JSON first if possible
          if (jsonData) {
            const textMatch = jsonData.match(/"text":\s*"([^"]+)"/);
            const descMatch = jsonData.match(/"description":\s*"([^"]+)"/);
            if (textMatch || descMatch) {
              goal.text = (textMatch?.[1] || descMatch?.[1] || '').trim();
              console.log(`Found goal text in JSON: ${goal.text}`);
            }
          }
          
          // If no text found yet, look in DOM
          if (!goal.text && goalElements.length > 0) {
            // List of common goal text elements
            const goalElement = goalElements[0]; // Use the first goal element as parent
            const textSelectors = [
              goalElement.querySelector('.goal-text, .goal-title, .title'),
              goalElement.querySelector('[class*="text"], [class*="title"]'),
              ...Array.from(goalElement.querySelectorAll('h1, h2, h3, h4, h5, span, div')).filter(el => 
                el.textContent && 
                el.textContent.length > 2 && 
                !el.textContent.includes('%') && 
                !el.textContent.match(/^\d+\s*tk$/i) &&
                !el.textContent.match(/^Goal:$/i)
              )
            ].filter(Boolean);
            
            for (const textEl of textSelectors) {
              const text = textEl.textContent.trim();
              if (text && text.length > 2) {
                goal.text = text;
                console.log(`Found goal text in DOM: ${goal.text}`);
                break;
              }
            }
          }
          
          // If still nothing, look for any element with "BRA" or other common goal keywords
          if (!goal.text) {
            const keywordElements = Array.from(document.querySelectorAll('*'))
              .filter(el => {
                const text = el.textContent?.trim();
                return text && text.length > 2 && (
                  text.includes('BRA') || 
                  text.includes('TAKE OFF') || 
                  text.includes('GOAL') || 
                  text.includes('OUTFIT')
                );
              });
            
            if (keywordElements.length > 0) {
              goal.text = keywordElements[0].textContent.trim();
              console.log(`Found goal text by keywords: ${goal.text}`);
            }
          }
        } catch (e) {
          console.log('Error extracting goal text:', e);
        }
        
        // Check if completed based on progress
        goal.completed = goal.progress >= 99; // Consider anything ≥99% as completed
        console.log(`Goal completed: ${goal.completed}`);
      }
      
      console.log('Final goal data:', goal);
      
      return {
        isLive: liveBadge !== null || liveStream !== null || liveStatusText === true,
        thumbnail: thumb || null,
        goal: goal
      };
    });
    
    // Clean up
    await page.close();
    browserService.releaseBrowser(browser);
    
    // Log successful status check with goal info
    console.log(`Status check for ${username}: Live=${pageData.isLive}, Goal=${pageData.goal.active ? `Progress: ${pageData.goal.progress}%` : 'None'}`);
    
    return pageData;
  } catch (error) {
    console.error(`Error checking status for ${username}:`, error);
    if (page) {
      try {
        await page.close();
      } catch (e) {}
    }
    browserService.releaseBrowser();
    return result;
  }
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
        const progressBar = generateProgressBar(goal.progress);
        const progressPercentage = Math.floor(goal.progress);
        text += `\n\n🎯 *Goal Progress:* ${progressPercentage}%\n${progressBar}`;
        
        if (goal.text) {
          // Sanitize goal text to prevent emoji issues
          const sanitizedText = goal.text
            .replace(/BRA|bra|👙/g, "👚") // Replace bra text/emoji with shirt emoji
            .replace(/OFF|off/g, "")      // Remove "off" text
            .replace(/TAKE/g, "")         // Remove "take" text
            .replace(/🚫|⛔|🔞/g, "")     // Remove prohibition emojis
            .replace(/\s+/g, " ")         // Normalize spaces
            .trim();                      // Trim extra spaces
          
          text += `\n*Goal:* ${sanitizedText || "Special Goal"}`;
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

/**
 * Start the monitoring routine
 * @param {Object} botInstance - Telegram bot instance
 */
async function startMonitoring(botInstance) {
  // First load the user data to ensure it's available
  await monitoredUsersModel.loadMonitoredUsers();
  await autoRecordConfigModel.loadAutoRecordConfig();
  
  console.log('Starting monitoring routines...');
  
  // Regular monitoring for status changes (every 5 minutes)
  monitorInterval = setInterval(async () => {
    try {
      await performFullStatusCheck(botInstance);
    } catch (error) {
      console.error("Error in status monitoring routine:", error);
    }
  }, config.MONITOR_INTERVAL);
  
  // Goal monitoring for auto-recording (every 15 seconds)
  goalCheckInterval = setInterval(async () => {
    try {
      await checkGoalsForAutoRecording(botInstance);
    } catch (error) {
      console.error("Error in goal monitoring routine:", error);
    }
  }, config.GOAL_CHECK_INTERVAL);
  
  console.log('Started monitoring routines');
  
  // Run an initial status check
  setTimeout(async () => {
    try {
      await performFullStatusCheck(botInstance);
    } catch (error) {
      console.error("Error in initial status check:", error);
    }
  }, 5000); // Wait 5 seconds before first check
}

/**
 * Full status check for all monitored users
 */
async function performFullStatusCheck(botInstance) {
  try {
    const monitoredUsers = monitoredUsersModel.getAllMonitoredUsers();
    
    if (monitoredUsers.length === 0) {
      return; // No users to monitor
    }
    
    console.log(`Full status check for ${monitoredUsers.length} monitored users...`);
    
    // Process users in batches to prevent memory issues
    const batchSize = 3; // Process 3 at a time
    
    for (let i = 0; i < monitoredUsers.length; i += batchSize) {
      const batch = monitoredUsers.slice(i, i + batchSize);
      
      // Process the batch and get results
      const results = await monitorBatch(batch, botInstance);
      
      // Save changes to disk after each batch
      await monitoredUsersModel.saveMonitoredUsers();
      
      // Small delay between batches to reduce load
      if (i + batchSize < monitoredUsers.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    console.log('Full status check complete');
  } catch (error) {
    console.error("Error in full status check:", error);
  }
}

/**
 * Check goals for live streamers and trigger auto-recording
 */
async function checkGoalsForAutoRecording(botInstance) {
  try {
    const monitoredUsers = monitoredUsersModel.getAllMonitoredUsers();
    
    // Only check users who are known to be live
    const liveUsers = monitoredUsers.filter(user => user.isLive);
    
    if (liveUsers.length === 0) {
      return; // No live users to check
    }
    
    // Process users in smaller batches to prevent memory issues
    const batchSize = 2; // Check fewer users at once since we're checking frequently
    
    for (let i = 0; i < liveUsers.length; i += batchSize) {
      const batch = liveUsers.slice(i, i + batchSize);
      
      // Check each user's goal status
      for (const user of batch) {
        try {
          const { username, chatId, isLive } = user;
          
          // Skip if not live
          if (!isLive) continue;
          
          // Skip if already auto-recording
          if (memoryService.isAutoRecordingActive(chatId, username)) {
            continue;
          }
          
          // Check only the goal status (lightweight check)
          const { goal } = await checkStripchatStatus(username);
          
          // Store previous goal state
          const previousGoalCompleted = user.lastGoalCompleted || false;
          
          // Update goal information
          if (goal && goal.active) {
            user.hasGoal = true;
            user.goalProgress = goal.progress;
            user.goalText = goal.text || '';
            user.goalCompleted = goal.completed;
            
            // If goal just completed, trigger auto-recording
            if (goal.completed && !previousGoalCompleted) {
              user.lastGoalCompleted = true;
              
              // Trigger auto-recording
              await triggerGoalAutoRecording(user, botInstance);
            } else {
              user.lastGoalCompleted = goal.completed;
            }
          } else {
            user.hasGoal = false;
            user.lastGoalCompleted = false;
          }
          
          // Update user in the database
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
        } catch (error) {
          console.error(`Error checking goals for ${user.username}:`, error);
        }
      }
      
      // Small delay between users
      if (i + batchSize < liveUsers.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    // Save changes to disk
    await monitoredUsersModel.saveMonitoredUsers();
  } catch (error) {
    console.error("Error in goal check routine:", error);
  }
}

/**
 * Trigger auto-recording for a completed goal
 */
async function triggerGoalAutoRecording(user, botInstance) {
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
  checkGoalsForAutoRecording,
  triggerGoalAutoRecording
};