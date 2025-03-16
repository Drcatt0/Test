/**
 * Info Command Handler - Fixed to use lightweightChecker
 */
const browserService = require('../../services/browserService');
const monitoredUsersModel = require('../../models/monitoredUsers');
const lightweightChecker = require('../../services/lightweightChecker');

/**
 * /info - Get detailed information about a streamer
 */
async function handler(ctx) {
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length < 1) {
    return ctx.reply("⚠️ Usage: /info username\n\nExample: /info AlicePlayss");
  }

  const username = args[0];

  // Show that we're processing
  await ctx.reply(`🔍 Searching for information about ${username}...`);
  
  // Check if the user exists
  const result = await browserService.quickStreamCheck(username);
  const exists = result && result.exists !== false;
  
  if (!exists) {
    return ctx.reply(`❌ Could not find streamer: ${username}`);
  }
  
  // Get streamer info
  try {
    const streamerInfo = await getStreamerInfo(username);
    
    if (!streamerInfo) {
      return ctx.reply(`❌ Could not retrieve information for ${username}. Please try again later.`);
    }
    
    // Format the streamer information
    const infoMessage = formatStreamerInfo(streamerInfo);
    
    // Send the formatted message
    await ctx.reply(infoMessage, { parse_mode: 'Markdown', disable_web_page_preview: true });
    
    // Use lightweight checker to get current live status and goals
    try {
      const status = await lightweightChecker.getCachedStatus(username, {
        includeGoal: true,
        forceRefresh: true
      });
      
      // If the streamer is live, send current status
      if (status.isLive) {
        const liveMessage = `🔴 *${username}* is currently LIVE!`;
        await ctx.reply(liveMessage, { parse_mode: 'Markdown' });
        
        // If we have goal information
        if (status.goal && status.goal.active) {
          const goalPercentage = Math.floor(status.goal.progress);
          const progressBar = generateProgressBar(goalPercentage);
          
          let goalMessage = `🎯 *Goal Progress:* ${progressBar} ${goalPercentage}%\n`;
          
          // Add token amount if available
          if (status.goal.tokenAmount) {
            goalMessage += `*Tokens:* ${status.goal.tokenAmount}tk\n`;
          }
          
          if (status.goal.text) {
            goalMessage += `*Goal:* ${status.goal.text}`;
          }
          
          await ctx.reply(goalMessage, { parse_mode: 'Markdown' });
        }
      } else if (status.nextBroadcast) {
        // If not live but has next broadcast time
        await ctx.reply(`📆 *Next scheduled broadcast:*\n${status.nextBroadcast}`, 
          { parse_mode: 'Markdown' });
      }
    } catch (statusError) {
      console.error("Error getting live status:", statusError);
    }
  } catch (error) {
    console.error("Error getting streamer info:", error);
    return ctx.reply(`❌ Error retrieving information for ${username}. Please try again later.`);
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
 * Format the streamer information into a markdown message
 */
function formatStreamerInfo(info) {
  let message = `📊 *${info.username} Profile Information*\n\n`;
  
  // Basic info
  if (info.languages && info.languages.length > 0) {
    message += `🗣️ *Languages:* ${info.languages.join(', ')}\n`;
  }
  
  if (info.age) {
    message += `🎂 *Age:* ${info.age}\n`;
  }
  
  if (info.ethnicity) {
    message += `👥 *Ethnicity:* ${info.ethnicity}\n`;
  }
  
  if (info.bodyType) {
    message += `👤 *Body Type:* ${info.bodyType}\n`;
  }
  
  if (info.hairColor) {
    message += `💇 *Hair:* ${info.hairColor}\n`;
  }
  
  if (info.eyeColor) {
    message += `👁️ *Eye Color:* ${info.eyeColor}\n`;
  }
  
  // Additional info
  if (info.interestedIn) {
    message += `❤️ *Interested In:* ${info.interestedIn}\n`;
  }
  
  if (info.specifics && info.specifics.length > 0) {
    message += `📏 *Specifics:* ${info.specifics.join(', ')}\n`;
  }
  
  if (info.subculture) {
    message += `🎭 *Subculture:* ${info.subculture}\n`;
  }
  
  // Interests
  if (info.interests && info.interests.length > 0) {
    message += `\n🔍 *Interests:*\n${info.interests.join(', ')}\n`;
  }
  
  return message;
}

async function getStreamerInfo(username) {
    let browser = null;
    let page = null;
    
    try {
      console.log(`Getting info for ${username}...`);
      
      // Get browser instance
      browser = await browserService.getBrowser();
      if (!browser) {
        console.error(`Failed to get browser instance for ${username}`);
        return null;
      }
  
      // Create a new page with optimized settings
      page = await browser.newPage();
      
      // Set random user agent
      await page.setUserAgent(browserService.getRandomUserAgent());
      
      // Set timeouts
      await page.setDefaultNavigationTimeout(30000);
      
      // Navigate to the user's PROFILE page - using the correct URL format
      const cacheBuster = Date.now();
      console.log(`Opening profile URL: https://stripchat.com/${username}/profile?_=${cacheBuster}`);
      await page.goto(`https://stripchat.com/${username}/profile?_=${cacheBuster}`, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
  
      // Wait for profile elements to load
      await page.waitForFunction(() => {
        return document.querySelectorAll('.field-row, [class*="field-row"]').length > 0 ||
               document.querySelectorAll('.profile-cover_avatar-wrapper, [class*="profile-cover_avatar-wrapper"]').length > 0;
      }, { timeout: 10000 }).catch(() => {
        console.log(`Timeout waiting for profile elements for ${username}, proceeding anyway`);
      });
  
      // Wait an additional moment
      await new Promise(resolve => setTimeout(resolve, 2000));
  
      // Log page content for debugging
      const pageContent = await page.content();
      console.log(`Info page loaded for ${username} with ${pageContent.length} characters`);
  
      // Extract all the info from the page with improved selectors
      const userInfo = await page.evaluate(() => {
        // Check for live badge specifically in the profile page layout
        const liveBadge = document.querySelector('.live-badge, [class*="live-badge"]');
        console.log('Live badge found:', liveBadge !== null);
        
        // Basic info extraction
        const info = {
          isLive: !!liveBadge,
          username: document.querySelector('h1')?.innerText || 
                   document.querySelector('[class*="name-heading"]')?.innerText || 
                   document.title.split('|')[0]?.trim(),
          languages: [],
          interests: []
        };
        
        console.log('Username:', info.username);
        console.log('Live status:', info.isLive);
        
        // Find all field rows with improved detection
        const fieldRows = document.querySelectorAll('.field-row, [class*="field-row"], [class*="profile-info"] > div');
        console.log('Field rows found:', fieldRows.length);
        
        // Process each field row
        fieldRows.forEach(row => {
          const className = row.className || '';
          const rowText = row.textContent.trim();
          
          // Process by field type - improved detection
          if (className.includes('languages') || rowText.includes('Languages')) {
            const langText = rowText.replace('Languages', '').replace(':', '').trim();
            info.languages = langText.split(',').map(l => l.trim()).filter(l => l);
            console.log('Found languages:', info.languages);
          } 
          else if (className.includes('age') || rowText.includes('Age')) {
            const ageText = rowText.replace('Age', '').replace(':', '').trim();
            const match = ageText.match(/(\d+)/);
            if (match) info.age = match[1] + ' years old';
            console.log('Found age:', info.age);
          } 
          else if (className.includes('interestedIn') || rowText.includes('Interested In')) {
            info.interestedIn = rowText.replace('Interested In', '').replace(':', '').trim();
            console.log('Found interested in:', info.interestedIn);
          } 
          else if (className.includes('bodyType') || rowText.includes('Body Type')) {
            info.bodyType = rowText.replace('Body Type', '').replace(':', '').trim();
            console.log('Found body type:', info.bodyType);
          } 
          else if (className.includes('specifics') || rowText.includes('Specifics')) {
            const specificsText = rowText.replace('Specifics', '').replace(':', '').trim();
            info.specifics = specificsText.split(',').map(s => s.trim()).filter(s => s);
            console.log('Found specifics:', info.specifics);
          } 
          else if (className.includes('ethnicity') || rowText.includes('Ethnicity')) {
            info.ethnicity = rowText.replace('Ethnicity', '').replace(':', '').trim();
            console.log('Found ethnicity:', info.ethnicity);
          } 
          else if (className.includes('hairColor') || rowText.includes('Hair')) {
            info.hairColor = rowText.replace('Hair', '').replace(':', '').trim();
            console.log('Found hair color:', info.hairColor);
          } 
          else if (className.includes('eyeColor') || rowText.includes('Eye Color')) {
            info.eyeColor = rowText.replace('Eye Color', '').replace(':', '').trim();
            console.log('Found eye color:', info.eyeColor);
          } 
          else if (className.includes('subculture') || rowText.includes('Subculture')) {
            info.subculture = rowText.replace('Subculture', '').replace(':', '').trim();
            console.log('Found subculture:', info.subculture);
          } 
          else if (className.includes('interests') || rowText.includes('Interests')) {
            // Find interest elements
            const interestElements = row.querySelectorAll('[class*="interest"], [class*="tag"]');
            if (interestElements.length > 0) {
              interestElements.forEach(el => {
                const interest = el.textContent.trim();
                if (interest) info.interests.push(interest);
              });
              console.log('Found interests from elements:', info.interests.length);
            } else {
              // Fall back to text parsing
              const interestsText = rowText.replace('Interests', '').replace(':', '').trim();
              if (interestsText) {
                info.interests = interestsText.split(',').map(i => i.trim()).filter(i => i);
                console.log('Found interests from text:', info.interests.length);
              }
            }
          }
        });
        
        // Next broadcast time (when offline)
        if (!info.isLive) {
          const nextBroadcastElements = document.querySelectorAll('.schedule-next-informer__weekday, .schedule-next-informer__link, [class*="schedule-next"]');
          if (nextBroadcastElements.length > 0) {
            let nextBroadcast = '';
            nextBroadcastElements.forEach(el => {
              nextBroadcast += el.textContent.trim() + ' ';
            });
            
            // Try to find the time as well
            const timeElements = document.querySelectorAll('.schedule-next-informer, [class*="schedule-next"]');
            timeElements.forEach(el => {
              if (el.textContent.includes('AM') || el.textContent.includes('PM') || 
                  el.textContent.includes(':')) {
                nextBroadcast += el.textContent.trim();
              }
            });
            
            info.nextBroadcast = nextBroadcast.trim();
            console.log('Found next broadcast:', info.nextBroadcast);
          }
        }
        
        return info;
      });
  
      await page.close();
      browserService.releaseBrowser(browser);
      
      console.log(`Successfully fetched info for ${username}: ${JSON.stringify(userInfo, null, 2)}`);
      
      return userInfo;
      
    } catch (error) {
      console.error(`Error getting info for ${username}:`, error);
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
  handler
};