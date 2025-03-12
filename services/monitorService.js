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
  let page = null;
  const result = { isLive: false, thumbnail: null, goal: { active: false, completed: false } };
  console.log(`🔍 Starting status check for ${username}...`);
  try {
    const browser = await browserService.getBrowser();
    if (!browser) {
      console.error(`❌ Failed to get browser to check status for ${username}`);
      return result;
    }
    page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      const url = req.url();
      if (resourceType === 'media' || (resourceType === 'image' && !url.includes('thumbnail') && !url.includes('preview'))) {
        req.abort();
      } else {
        req.continue();
      }
    });
    await page.setDefaultNavigationTimeout(30000);
    await page.goto(`https://stripchat.com/${username}`, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 3000)));
    console.log(`✅ Completed page load for ${username}, analyzing status...`);
    const pageData = await page.evaluate(() => {
      const liveBadge = document.querySelector(".live-badge");
      const liveStream = document.querySelector("video");
      const liveStatusText = document.querySelector(".status")?.innerText.includes("Live");
      const thumb = document.querySelector('meta[property="og:image"]')?.content;
      let goal = { active: false, completed: false, progress: 0, text: '' };
      const goalElement = document.querySelector('.goal-widget, .goal, .progress-bar-container');
      if (goalElement) {
        goal.active = true;
        const progressText = goalElement.innerText.match(/(\d+)%/);
        goal.progress = progressText ? parseInt(progressText[1], 10) : 0;
        goal.completed = goal.progress >= 99;
      }
      return {
        isLive: liveBadge !== null || liveStream !== null || liveStatusText === true,
        thumbnail: thumb || null,
        goal: goal
      };
    });
    await page.close();
    browserService.releaseBrowser(browser);
    console.log(`📊 Status check for ${username}: Live=${pageData.isLive}, Goal=${pageData.goal.active ? `Progress: ${pageData.goal.progress}%` : 'None'}`);
    return pageData;
  } catch (error) {
    console.error(`❌ Error checking status for ${username}:`, error);
    if (page) {
      try { await page.close(); } catch (e) {}
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
  function runGoalCheck() {
    console.log("🔄 Running goal check for auto-recording...");
    checkGoalsForAutoRecordinɡ(botInstance)
      .catch(error => console.error("❌ Error in goal monitoring routine:", error));
    goalCheckInterval = setTimeout(runGoalCheck, 15000);
  }
  goalCheckInterval = setTimeout(runGoalCheck, 15000);

  console.log('📡 Monitoring is now active!');

  // Initial full status check after 5 seconds
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
 */
async function checkGoalsForAutoRecordinɡ(botInstance) {
  console.log("🔎 Checking goals for all live users...");
  try {
    const monitoredUsers = monitoredUsersModel.getAllMonitoredUsers();
    console.log(`📡 Found ${monitoredUsers.length} monitored users`);
    const liveUsers = monitoredUsers.filter(user => user.isLive);
    console.log(`🎥 Checking ${liveUsers.length} live users for goals`);
    if (liveUsers.length === 0) {
      console.log("⚠️ No live users found, skipping goal check.");
      return;
    }
    for (const user of liveUsers) {
      console.log(`🔍 Checking goals for: ${user.username}`);
      const { goal } = await checkStripchatStatus(user.username);
      if (goal && goal.active) {
        console.log(`🎯 ${user.username} has an active goal: ${goal.progress}% complete`);
        if (goal.completed) {
          console.log(`🚀 Goal completed for ${user.username}, triggering auto-recording...`);
          await triggerGoalAutoRecording(user, botInstance);
        }
      } else {
        console.log(`⚠️ No active goal found for ${user.username}`);
      }
    }
  } catch (error) {
    console.error("❌ Error in goal check routine:", error);
  }
}

/**
 * Trigger auto-recording for a completed goal
 */
async function triggerGoalAutoRecording(user, botInstance) {
  console.log(`🚀 Goal completed for ${user.username}, checking auto-recording eligibility...`);
  const eligibleUsers = autoRecordConfigModel.getUsersWithAutoRecordForUsername(
    user.username,
    user.chatId
  );
  console.log(`📡 Found ${eligibleUsers.length} eligible users for auto-recording: ${user.username}`);
  for (const eligibleUser of eligibleUsers) {
    if (memoryService.isAutoRecordingActive(user.chatId, user.username)) {
      console.log(`⚠️ Already auto-recording ${user.username}`);
      continue;
    }
    const recordingKey = memoryService.addActiveAutoRecording(user.chatId, user.username);
    const duration = eligibleUser.duration || 180;
    try {
      console.log(`🎬 Auto-recording ${user.username} for ${duration} seconds`);
      await botInstance.telegram.sendMessage(
        user.chatId,
        `🎉 *${user.username}* completed their goal!\n\n` +
          `🎯 *Goal:* ${user.goalText || 'No description'}\n\n` +
          `🎬 *Auto-recording for ${duration} seconds...*`,
        { parse_mode: 'Markdown' }
      );
      const mockCtx = {
        message: { chat: { id: user.chatId }, from: { id: eligibleUser.userId } },
        reply: (text, options) => botInstance.telegram.sendMessage(user.chatId, text, options),
        replyWithVideo: (data) =>
          botInstance.telegram.sendVideo(user.chatId, data.source, { caption: data.caption }),
        telegram: botInstance.telegram
      };
      await recordService.executeRecord(mockCtx, user.username, duration);
    } catch (error) {
      console.error(`❌ Error auto-recording ${user.username}:`, error);
    } finally {
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
  checkGoalsForAutoRecordinɡ,
  triggerGoalAutoRecording
};
