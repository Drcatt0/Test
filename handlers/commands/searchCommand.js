/**
 * Search Command Handler
 * Allows premium users to search streamers by category
 */
const { Markup } = require('telegraf');
const browserService = require('../../services/browserService');
const premiumUsersModel = require('../../models/premiumUsers');

// Available search categories
const SEARCH_CATEGORIES = [
  "teen", "milf", "bbw", "asian", "latina", "ebony", "blonde", "brunette", 
  "redhead", "tattoo", "piercing", "curvy", "petite", "mature", "couple", 
  "bigboobs", "smallboobs", "hairy", "shaved", "squirt", "anal", "bigass", 
  "feet", "smoking", "pregnant", "new"
];

/**
 * /search - Search streamers by category (premium only)
 */
async function handler(ctx) {
  const args = ctx.message.text.split(' ').slice(1);
  const userId = ctx.message.from.id;
  
  // Check if user has premium
  if (!premiumUsersModel.isPremiumUser(userId)) {
    return ctx.reply(
      "⭐ *Premium Feature*\n\n" +
      "Searching streamers by category is a premium feature. Upgrade to premium to use this feature!\n\n" +
      "Type /premium for more information.",
      { parse_mode: 'Markdown' }
    );
  }
  
  // If no category provided, show available categories
  if (args.length < 1) {
    // Group categories into chunks of 3 for better presentation
    const categoryRows = [];
    for (let i = 0; i < SEARCH_CATEGORIES.length; i += 3) {
      categoryRows.push(SEARCH_CATEGORIES.slice(i, i + 3).map(cat => `/${cat}`));
    }
    
    return ctx.reply(
      "🔍 *Search Streamers by Category*\n\n" +
      "Usage: /search category\n\n" +
      "Available categories:",
      {
        parse_mode: 'Markdown',
        reply_markup: {
          keyboard: categoryRows,
          resize_keyboard: true,
          one_time_keyboard: true
        }
      }
    );
  }
  
  // Get the search category
  const category = args[0].toLowerCase();
  
  // Check if it's a valid category
  if (!SEARCH_CATEGORIES.includes(category)) {
    return ctx.reply(
      "⚠️ Invalid category. Please use one of the available categories:\n\n" +
      SEARCH_CATEGORIES.join(", ")
    );
  }
  
  await ctx.reply(`🔍 Searching for ${category} streamers...`);
  
  try {
    // Perform the search
    const results = await searchStreamers(category);
    
    if (!results || results.length === 0) {
      return ctx.reply(`❌ No streamers found for category: ${category}`);
    }
    
    // Format the results
    let message = `🔍 *Search Results for "${category}"*\n\n`;
    const inlineKeyboard = [];
    
    results.forEach((streamer, index) => {
      message += `${index + 1}. *${streamer.username}*`;
      
      if (streamer.isLive) {
        message += ` - 🔴 LIVE`;
      }
      
      if (streamer.viewers) {
        message += ` - ${streamer.viewers} viewers`;
      }
      
      if (streamer.tags && streamer.tags.length > 0) {
        message += `\n   Tags: ${streamer.tags.join(', ')}`;
      }
      
      message += '\n\n';
      
      // Add row of buttons for each streamer
      inlineKeyboard.push([
        Markup.button.callback(`📋 Info`, `searchInfo:${streamer.username}`),
        Markup.button.callback(`🔔 Add`, `searchAdd:${streamer.username}`)
      ]);
    });
    
    // Send the message with inline buttons
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(inlineKeyboard)
    });
    
  } catch (error) {
    console.error(`Error searching for ${category} streamers:`, error);
    return ctx.reply("❌ Error performing search. Please try again later.");
  }
}

/**
 * Search for streamers by category
 */
async function searchStreamers(category, limit = 10) {
  let browser = null;
  let page = null;
  
  try {
    console.log(`Searching streamers for category: ${category}`);
    
    // Get browser instance
    browser = await browserService.getBrowser();
    if (!browser) {
      console.error("Failed to get browser instance for search");
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
    
    // Go to the category page - FIXED URL FORMAT
    const cacheBuster = Date.now();
    await page.goto(`https://stripchat.com/search/${category}?_=${cacheBuster}`, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Wait for content to load
    await page.waitForSelector('[class*="model-list"] [class*="model-card"], [class*="sc-fa"]', { timeout: 10000 })
      .catch(() => console.log("Timeout waiting for model cards, proceeding anyway"));

    // Log the page content for debugging
    const pageContent = await page.content();
    console.log(`Page loaded with ${pageContent.length} characters`);

    // Extract streamer information
    const streamers = await page.evaluate((maxStreamers) => {
      const result = [];
      
      // Look for model cards on the page (trying various selectors)
      const modelCards = document.querySelectorAll(
        '[class*="model-list"] [class*="model-card"], ' +
        '[class*="sc-fa"], ' +
        '[class*="content-row"] > [class*="item"]'
      );
      
      console.log(`Found ${modelCards.length} model cards`);
      
      for (const card of modelCards) {
        if (result.length >= maxStreamers) break;
        
        try {
          // Check if streamer is live
          const isLive = !!card.querySelector('[class*="live-badge"], [class*="online"], [class*="live"]');
          
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
            isLive,
            tags: []
          };
          
          // Try to get viewers count if live
          if (isLive) {
            const viewersElement = card.querySelector('[class*="viewers"]');
            if (viewersElement) {
              streamer.viewers = viewersElement.textContent.trim();
            }
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

    // Log the number of streamers found
    console.log(`Found ${streamers.length} streamers for category ${category}`);
    
    await page.close();
    browserService.releaseBrowser(browser);
    
    return streamers;
    
  } catch (error) {
    console.error(`Error searching for ${category} streamers:`, error);
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
      pattern: /^searchInfo:(.+)$/,
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
      pattern: /^searchAdd:(.+)$/,
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