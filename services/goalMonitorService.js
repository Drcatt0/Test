/**
 * Goal Monitor Service
 * Real-time monitoring of goals for live streams
 * With precise 15-second check interval
 */
const browserService = require('./browserService');
const monitoredUsersModel = require('../models/monitoredUsers');
const autoRecordConfigModel = require('../models/autoRecordConfig');
const recordService = require('./recordService');
const memoryService = require('./memoryService');

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
  
  // Start the monitoring interval (every 15 seconds for real-time monitoring as requested)
  monitorInterval = setInterval(async () => {
    try {
      await monitorAllGoals(botInstance);
    } catch (error) {
      console.error("❌ Error in goal monitoring routine:", error);
    }
  }, 15 * 1000); // 15 seconds as requested
  
  console.log("✅ Goal monitoring service started (checking every 15 seconds)");
  
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
  const now = new Date();
  console.log(`🎯 [${now.toISOString()}] Checking ${activeGoalMonitors.size} active goal monitors...`);
  
  // Process in small batches to avoid browser issues
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
    
    // Small delay between batches
    if (i + batchSize < usernames.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

/**
 * Check the status of a goal for a specific streamer
 */
async function checkGoalStatus(username, botInstance) {
  const normalizedUsername = username.toLowerCase();
  const monitor = activeGoalMonitors.get(normalizedUsername);
  
  if (!monitor) {
    console.log(`No active monitor found for ${normalizedUsername}`);
    return false;
  }
  
  // Check if we're checking too frequently
  const now = Date.now();
  const timeSinceLastCheck = now - monitor.lastChecked;
  
  if (timeSinceLastCheck < 5000) { // 5 seconds minimum between checks
    return false;
  }
  
  // Update last checked time
  monitor.lastChecked = now;
  
  // Check the streamer's status
  const status = await getStreamStatus(username);
  
  // If user is not live, mark as offline
  if (!status.isLive) {
    if (monitor.isLive) {
      console.log(`🔴→⚫ ${username} is no longer live, pausing goal monitoring`);
    }
    
    monitor.isLive = false;
    return false;
  }
  
  // If user was offline but is now live again, send notification
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
        console.error(`Error sending live again notification for ${username} to ${chatId}:`, error);
      }
    }
  }
  
  // Skip if no active goal
  if (!status.goal || !status.goal.active) {
    return false;
  }
  
  // First check or goal reset, just store the data
  if (!monitor.goal) {
    monitor.goal = status.goal;
    
    // Notify all chats about goal
    for (const chatId of monitor.chatIds) {
      try {
        const progressBar = generateProgressBar(status.goal.progress);
        const goalText = status.goal.text || "Special Goal";
        
        await botInstance.telegram.sendMessage(
          chatId,
          `🎯 *${username}* has an active goal!\n\n` +
          `Goal: ${goalText}\n` +
          `Progress: ${progressBar} ${Math.round(status.goal.progress)}%`,
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        console.error(`Error sending goal notification for ${username} to ${chatId}:`, error);
      }
    }
    
    return true;
  }
  
  // Check for goal change or reset
  if (status.goal.text && monitor.goal.text && 
      status.goal.text !== monitor.goal.text) {
    
    // Goal has changed, update and notify
    monitor.goal = status.goal;
    
    // Notify all chats about new goal
    for (const chatId of monitor.chatIds) {
      try {
        const progressBar = generateProgressBar(status.goal.progress);
        const goalText = status.goal.text || "Special Goal";
        
        await botInstance.telegram.sendMessage(
          chatId,
          `🎯 *${username}* has a new goal!\n\n` +
          `Goal: ${goalText}\n` +
          `Progress: ${progressBar} ${Math.round(status.goal.progress)}%`,
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        console.error(`Error sending new goal notification for ${username} to ${chatId}:`, error);
      }
    }
    
    return true;
  }
  
  // If significant progress update (10% change), send notification
  const progressDiff = Math.abs(status.goal.progress - monitor.goal.progress);
  if (progressDiff >= 10) {
    // Update goal progress
    monitor.goal.progress = status.goal.progress;
    
    // Notify all chats about progress update
    for (const chatId of monitor.chatIds) {
      try {
        const progressBar = generateProgressBar(status.goal.progress);
        const goalText = status.goal.text || "Special Goal";
        
        await botInstance.telegram.sendMessage(
          chatId,
          `📊 *${username}* goal progress update!\n\n` +
          `Goal: ${goalText}\n` +
          `Progress: ${progressBar} ${Math.round(status.goal.progress)}%`,
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        console.error(`Error sending progress notification for ${username} to ${chatId}:`, error);
      }
    }
  }
  
  // Check for goal completion
  if (status.goal.completed && !monitor.goal.completed) {
    console.log(`🎉 Goal completed for ${username}!`);
    
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
            
            // Trigger recording
            await triggerGoalRecording(username, status.goal, chatId, botInstance, eligibleUser);
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
 * Trigger a recording for a completed goal
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
    
    // Generate progress bar
    const progressBar = generateProgressBar(goal.progress);
    
    // Notify the user
    await botInstance.telegram.sendMessage(
      chatId,
      `🎬 *Auto-recording ${username} for ${duration} seconds!*\n\n` +
      `🎯 *Goal:* ${sanitizedGoalText}\n` +
      `📊 *Progress:* ${progressBar} ${Math.floor(goal.progress)}%`,
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
 * Get the stream status for a username
 */
async function getStreamStatus(username) {
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

    // Wait for essential content
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

    // Extract status information
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