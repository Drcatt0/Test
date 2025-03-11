const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');

// Browser management
let sharedBrowser = null;
let lastBrowserActivity = Date.now();
let browserInUse = false;

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
 * Enhanced checkStripchatStatus with goal detection and memory optimization
 */
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
      
      // Goal detection
      let goal = {
        active: false,
        completed: false,
        progress: 0,
        totalAmount: 0,
        currentAmount: 0,
        text: ''
      };
      
      // Look for goal elements with various possible selectors
      const goalElements = [
        document.querySelector('.goal-widget'),
        document.querySelector('.goal'),
        document.querySelector('[data-test="goal-container"]'),
        document.querySelector('[data-test="goal-widget"]'),
        ...Array.from(document.querySelectorAll('[class*="goal"]')).filter(el => 
          el.innerHTML.includes('progress') || 
          el.innerHTML.includes('bar') || 
          el.innerHTML.includes('%')
        )
      ].filter(Boolean);
      
      if (goalElements.length > 0) {
        // Use the first goal element found
        const goalElement = goalElements[0];
        goal.active = true;
        
        // Try to get progress from various possible elements
        const progressElements = [
          goalElement.querySelector('.progress-bar'),
          goalElement.querySelector('[class*="progress"]'),
          goalElement.querySelector('[style*="width"]'),
          ...Array.from(goalElement.querySelectorAll('*')).filter(el => 
            el.style && el.style.width && el.style.width.includes('%')
          )
        ].filter(Boolean);
        
        if (progressElements.length > 0) {
          const progressEl = progressElements[0];
          const progressStyle = progressEl.style.width || '';
          
          if (progressStyle.includes('%')) {
            goal.progress = parseFloat(progressStyle);
          } else {
            const ariaValue = progressEl.getAttribute('aria-valuenow');
            if (ariaValue) {
              goal.progress = parseFloat(ariaValue);
            }
          }
        }
        
        // Try to extract current and total amounts
        const amountPatterns = [
          // Look for amounts displayed as "X/Y tokens"
          /(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/,
          // Look for amounts like "X of Y" or "X out of Y"
          /(\d+(?:[.,]\d+)?)\s*(?:of|out of)\s*(\d+(?:[.,]\d+)?)/
        ];
        
        const goalText = goalElement.textContent;
        
        for (const pattern of amountPatterns) {
          const match = goalText.match(pattern);
          if (match) {
            goal.currentAmount = parseFloat(match[1].replace(',', ''));
            goal.totalAmount = parseFloat(match[2].replace(',', ''));
            break;
          }
        }
        
        // Try to get goal text
        const textElements = [
          goalElement.querySelector('.goal-text'),
          goalElement.querySelector('.title'),
          goalElement.querySelector('h3'),
          goalElement.querySelector('[class*="title"]'),
          ...Array.from(goalElement.querySelectorAll('*')).filter(el => 
            el.innerText && el.innerText.length > 5 && 
            !el.innerText.includes('%') && 
            !el.innerText.match(/^\d+\/\d+$/)
          )
        ].filter(Boolean);
        
        if (textElements.length > 0) {
          goal.text = textElements[0].innerText.trim();
        }
        
        // Check if completed based on progress or amounts
        goal.completed = goal.progress >= 100 || 
                        (goal.currentAmount >= goal.totalAmount && goal.totalAmount > 0);
                        
        // If we have amounts but no progress percentage, calculate it
        if (goal.totalAmount > 0 && goal.currentAmount >= 0 && goal.progress === 0) {
          goal.progress = (goal.currentAmount / goal.totalAmount) * 100;
        }
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
async function checkAndNotify(username, chatId, botInstance) {
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
      if (isLive && thumbnail) {
        await botInstance.telegram.sendPhoto(chatId, thumbnail, {
          caption: text,
          parse_mode: 'Markdown'
        });
      } else {
        await botInstance.telegram.sendMessage(chatId, text, { parse_mode: 'Markdown' });
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

// Export all functions needed by other modules
module.exports = {
  checkStripchatStatus,
  checkAndNotify,
  monitorBatch,
  generateProgressBar,
  getBrowser,
  releaseBrowser
};