/**
 * Popular Command Handler
 * Gets a list of popular live streamers
 */
const { Markup } = require('telegraf');
const browserService = require('../../services/browserService');
const monitoredUsersModel = require('../../models/monitoredUsers');

/**
 * /popular - Get a list of currently popular live streamers
 */
async function handler(ctx) {
  await ctx.reply("🔍 Searching for popular live streamers...");
  
  try {
    const popularStreamers = await getPopularStreamers();
    
    if (!popularStreamers || popularStreamers.length === 0) {
      return ctx.reply("❌ Could not retrieve popular streamers at this time. Please try again later.");
    }
    
    // Format the streamer list with inline buttons
    let message = "🔥 *Popular Live Streamers*\n\n";
    const inlineKeyboard = [];
    
    popularStreamers.forEach((streamer, index) => {
      message += `${index + 1}. *${streamer.username}*`;
      
      if (streamer.viewers) {
        message += ` - ${streamer.viewers} viewers`;
      }
      
      if (streamer.tags && streamer.tags.length > 0) {
        message += `\n   Tags: ${streamer.tags.join(', ')}`;
      }
      
      message += '\n\n';
      
      // Add row of buttons for each streamer
      inlineKeyboard.push([
        Markup.button.callback(`📋 Info`, `getInfo:${streamer.username}`),
        Markup.button.callback(`📺 Watch`, `watchStream:${streamer.username}`),
        Markup.button.callback(`🔔 Add`, `addUser:${streamer.username}`)
      ]);
    });
    
    // Send the message with inline buttons
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(inlineKeyboard)
    });
    
  } catch (error) {
    console.error("Error getting popular streamers:", error);
    return ctx.reply("❌ Error retrieving popular streamers. Please try again later.");
  }
}

/**
 * Get a list of popular streamers from Stripchat
 */
async function getPopularStreamers(limit = 10) {
  let browser = null;
  let page = null;
  
  try {
    console.log("Getting popular streamers...");
    
    // Get browser instance
    browser = await browserService.getBrowser();
    if (!browser) {
      console.error("Failed to get browser instance for popular streamers");
      return null;
    }

    // Create a new page
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
    
    // Go to recommended/popular page - FIXED URL
    const cacheBuster = Date.now();
    await page.goto(`https://stripchat.com/girls/recommended?_=${cacheBuster}`, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Wait for content to load
    await page.waitForSelector('[class*="model-list"] [class*="model-card"], [class*="sc-fa"], [class*="content-row"] > [class*="item"]', { timeout: 10000 })
      .catch(() => console.log("Timeout waiting for model cards, proceeding anyway"));

    // Log the page content for debugging
    const pageContent = await page.content();
    console.log(`Page loaded with ${pageContent.length} characters`);

    // Extract streamer information
    const streamers = await page.evaluate((maxStreamers) => {
      const result = [];
      
      // Look for model cards on the page (try multiple selectors)
      const modelCards = document.querySelectorAll(
        '[class*="model-list"] [class*="model-card"], ' +
        '[class*="sc-fa"], ' +
        '[class*="content-row"] > [class*="item"]'
      );
      
      console.log(`Found ${modelCards.length} model cards`);
      
      for (const card of modelCards) {
        if (result.length >= maxStreamers) break;
        
        try {
          // Check if streamer is live - this should always be true for recommended page
          const isLive = !!card.querySelector('[class*="live-badge"], [class*="online"], [class*="live"]') || true;
          
          if (!isLive) continue;
          
          // Extract username - try different selectors
          let username = '';
          const usernameElement = card.querySelector('[class*="username"], [class*="name"], a');
          
          if (usernameElement) {
            username = usernameElement.textContent.trim();
            
            // If no text content, try extracting from href
            if (!username && usernameElement.href) {
              const match = usernameElement.href.match(/\/([^\/]+)$/);
              if (match && match[1]) username = match[1];
            }
          }
          
          if (!username) continue;
          
          // Create streamer object
          const streamer = {
            username,
            isLive: true,
            tags: []
          };
          
          // Try to get viewers count
          const viewersElement = card.querySelector('[class*="viewers"]');
          if (viewersElement) {
            streamer.viewers = viewersElement.textContent.trim();
          }
          
          // Get tags
          const tagElements = card.querySelectorAll('[class*="tag"]');
          tagElements.forEach(tag => {
            const tagText = tag.textContent.trim();
            if (tagText) streamer.tags.push(tagText);
          });
          
          result.push(streamer);
        } catch (e) {
          console.error("Error processing model card:", e);
        }
      }
      
      return result;
    }, limit);

    await page.close();
    browserService.releaseBrowser(browser);
    
    // Log the number of streamers found
    console.log(`Found ${streamers.length} popular streamers`);
    
    return streamers;
    
  } catch (error) {
    console.error("Error getting popular streamers:", error);
    if (page) {
      try { await page.close(); } catch (e) {}
    }
    if (browser) {
      browserService.releaseBrowser(browser);
    }
    return null;
  }
}

module.exports = {
  handler,
  // Export the callback handlers
  actions: [
    {
      pattern: /^getInfo:(.+)$/,
      handler: async (ctx) => {
        const username = ctx.match[1];
        ctx.answerCbQuery(`Getting info for ${username}...`);
        
        // Create a fake context to reuse the info command
        const infoCommand = require('./infoCommand');
        ctx.message = { text: `/info ${username}`, chat: ctx.chat, from: ctx.from };
        return infoCommand.handler(ctx);
      }
    },
    {
      pattern: /^watchStream:(.+)$/,
      handler: async (ctx) => {
        const username = ctx.match[1];
        await ctx.answerCbQuery(`Opening ${username}'s stream...`);
        
        // Send a message with the stream link
        await ctx.reply(
          `🔴 Watch *${username}* live stream:\n` +
          `[Click here to watch](https://stripchat.com/${username})`,
          { parse_mode: 'Markdown' }
        );
      }
    },
    {
      pattern: /^addUser:(.+)$/,
      handler: async (ctx) => {
        const username = ctx.match[1];
        ctx.answerCbQuery(`Adding ${username} to your monitors...`);
        
        // Create a fake context to reuse the add command
        const addCommand = require('./addCommand');
        ctx.message = { text: `/add ${username}`, chat: ctx.chat, from: ctx.from };
        return addCommand.handler(ctx);
      }
    }
  ]
};