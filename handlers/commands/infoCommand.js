/**
 * Info Command Handler
 * Gets detailed profile information about a streamer
 */
const browserService = require('../../services/browserService');
const monitoredUsersModel = require('../../models/monitoredUsers');
const monitorService = require('../../services/monitorService');

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
  const exists = await monitorService.checkUsernameExists(username);
  
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
    
    // If the streamer is live, send current status
    if (streamerInfo.isLive) {
      const liveMessage = `🔴 *${username}* is currently LIVE!`;
      await ctx.reply(liveMessage, { parse_mode: 'Markdown' });
      
      // If we have goal information
      if (streamerInfo.goal && streamerInfo.goal.active) {
        const goalPercentage = Math.floor(streamerInfo.goal.progress);
        const progressBar = generateProgressBar(goalPercentage);
        
        const goalMessage = 
          `🎯 *Goal Progress:* ${progressBar} ${goalPercentage}%\n` +
          (streamerInfo.goal.text ? `*Goal:* ${streamerInfo.goal.text}` : '');
        
        await ctx.reply(goalMessage, { parse_mode: 'Markdown' });
      }
    } else if (streamerInfo.nextBroadcast) {
      // If not live but has next broadcast time
      await ctx.reply(`📆 *Next scheduled broadcast:*\n${streamerInfo.nextBroadcast}`, 
        { parse_mode: 'Markdown' });
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

/**
 * Get detailed information about a streamer
 */
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
    
    // Navigate to the user's page
    const cacheBuster = Date.now();
    await page.goto(`https://stripchat.com/${username}?_=${cacheBuster}`, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Wait for page to settle
    await page.waitForFunction(() => {
      return document.querySelectorAll('.field-row, [class*="field-row"]').length > 0 ||
             document.querySelectorAll('.profile-header, [class*="profile-header"]').length > 0;
    }, { timeout: 10000 }).catch(() => {
      console.log(`Timeout waiting for profile elements for ${username}, proceeding anyway`);
    });

    // Wait an additional moment
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Log page content for debugging
    const pageContent = await page.content();
    console.log(`Info page loaded for ${username} with ${pageContent.length} characters`);

    // Extract all the info from the page
    const userInfo = await page.evaluate(() => {
      const logElements = (selector) => {
        const elements = document.querySelectorAll(selector);
        console.log(`Found ${elements.length} elements matching: ${selector}`);
        elements.forEach(el => console.log(el.className, el.textContent));
      };
      
      // Log key elements for debugging
      logElements('.field-row, [class*="field-row"]');
      logElements('.avatar, [class*="avatar"]');
      
      // Check if live
      const isLive = !!document.querySelector('.live-badge, [class*="live-badge"]') || 
                    !!document.querySelector('video') || 
                    (document.querySelector('.status, [class*="status"]')?.innerText || '').includes('Live');
      
      // Basic info extraction
      const info = {
        isLive: isLive,
        username: document.querySelector('h1')?.innerText || 
                 document.querySelector('[class*="name-heading"]')?.innerText || 
                 document.title.split('|')[0]?.trim(),
        languages: [],
        interests: []
      };
      
      // Function to extract field text
      const getFieldText = (container, fieldLabel) => {
        if (!container) return null;
        
        // Try different methods to find the field value
        const labelElement = Array.from(container.querySelectorAll('*')).find(
          el => el.textContent.includes(fieldLabel)
        );
        
        if (!labelElement) return null;
        
        // Try to find the adjacent element with the value
        const siblingElements = Array.from(container.children);
        const labelIndex = siblingElements.indexOf(labelElement);
        
        if (labelIndex >= 0 && labelIndex < siblingElements.length - 1) {
          return siblingElements[labelIndex + 1].textContent.trim();
        }
        
        // Try parent's next sibling
        const parentNextSibling = labelElement.parentElement.nextElementSibling;
        if (parentNextSibling) {
          return parentNextSibling.textContent.trim();
        }
        
        // Try directly from the container
        const containerText = container.textContent.trim();
        if (containerText.includes(fieldLabel)) {
          const afterLabel = containerText.split(fieldLabel)[1].trim();
          // Extract first line
          return afterLabel.split('\n')[0].trim();
        }
        
        return null;
      };
      
      // Find all field rows (language, age, etc)
      // Using flexible selectors to catch different site versions
      const fieldRows = document.querySelectorAll('.field-row, [class*="field-row"], [class*="profile-info"] > div');
      
      fieldRows.forEach(row => {
        const className = row.className || '';
        const rowText = row.textContent.trim();
        
        // Process by field type
        if (className.includes('languages') || rowText.includes('Languages')) {
          const langText = getFieldText(row, 'Languages') || rowText.replace('Languages', '').trim();
          info.languages = langText.split(',').map(l => l.trim()).filter(l => l);
        } 
        else if (className.includes('age') || rowText.includes('Age')) {
          const ageText = getFieldText(row, 'Age') || rowText.replace('Age', '').trim();
          const match = ageText.match(/(\d+)/);
          if (match) info.age = match[1] + ' years old';
        } 
        else if (className.includes('interestedIn') || rowText.includes('Interested In')) {
          info.interestedIn = getFieldText(row, 'Interested In') || rowText.replace('Interested In', '').trim();
        } 
        else if (className.includes('bodyType') || rowText.includes('Body Type')) {
          info.bodyType = getFieldText(row, 'Body Type') || rowText.replace('Body Type', '').trim();
        } 
        else if (className.includes('specifics') || rowText.includes('Specifics')) {
          const specificsText = getFieldText(row, 'Specifics') || rowText.replace('Specifics', '').trim();
          info.specifics = specificsText.split(',').map(s => s.trim()).filter(s => s);
        } 
        else if (className.includes('ethnicity') || rowText.includes('Ethnicity')) {
          info.ethnicity = getFieldText(row, 'Ethnicity') || rowText.replace('Ethnicity', '').trim();
        } 
        else if (className.includes('hairColor') || rowText.includes('Hair')) {
          info.hairColor = getFieldText(row, 'Hair') || rowText.replace('Hair', '').trim();
        } 
        else if (className.includes('eyeColor') || rowText.includes('Eye Color')) {
          info.eyeColor = getFieldText(row, 'Eye Color') || rowText.replace('Eye Color', '').trim();
        } 
        else if (className.includes('subculture') || rowText.includes('Subculture')) {
          info.subculture = getFieldText(row, 'Subculture') || rowText.replace('Subculture', '').trim();
        } 
        else if (className.includes('interests') || rowText.includes('Interests')) {
          // Find interest elements
          const interestElements = row.querySelectorAll('[class*="interest"], [class*="tag"]');
          if (interestElements.length > 0) {
            interestElements.forEach(el => {
              const interest = el.textContent.trim();
              if (interest) info.interests.push(interest);
            });
          } else {
            // Try to parse from text
            const interestsText = getFieldText(row, 'Interests') || rowText.replace('Interests', '').trim();
            if (interestsText) {
              info.interests = interestsText.split(',').map(i => i.trim()).filter(i => i);
            }
          }
        }
      });
      
      // Next broadcast time (when offline)
      if (!isLive) {
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
        }
      }
      
      // Goal information if live
      if (isLive) {
        // Look for goal information on the page
        let goal = {
          active: false,
          progress: 0,
          text: '',
          completed: false
        };

        // Try to find goal information
        try {
          // Look for goal progress elements
          const progressElements = document.querySelectorAll(
            "[role='progressbar'], [class*='progress'], [class*='goal'], [class*='epic-goal-progress']"
          );
          
          if (progressElements.length > 0) {
            goal.active = true;
            
            // Try to extract progress percentage
            for (const el of progressElements) {
              // Look for style with width as percentage
              const style = window.getComputedStyle(el);
              if (style.width && style.width.includes('%')) {
                goal.progress = parseFloat(style.width);
                if (goal.progress >= 95) goal.completed = true;
                break;
              }
              
              // Look for aria-valuenow attribute
              const valueNow = el.getAttribute('aria-valuenow');
              if (valueNow) {
                goal.progress = parseFloat(valueNow);
                if (goal.progress >= 95) goal.completed = true;
                break;
              }
              
              // Look for text with percentage
              const progressText = el.textContent;
              const progressMatch = progressText.match(/(\d+(\.\d+)?)%/);
              if (progressMatch) {
                goal.progress = parseFloat(progressMatch[1]);
                if (goal.progress >= 95) goal.completed = true;
                break;
              }
            }
            
            // Look for goal text elements
            const goalTextElements = document.querySelectorAll(
              "[class*='goal'] div, [class*='Goal'] div, [class*='epic-goal-progress'], [class*='epic-goal-progress_information']"
            );
            
            for (const el of goalTextElements) {
              if (el.innerText && el.innerText.length > 3) {
                if (el.innerText.includes('Goal:') || el.innerText.includes('tk')) {
                  goal.text = el.innerText.trim();
                  break;
                }
              }
            }
            
            // Look for token amount
            const tokenElements = document.querySelectorAll("[class*='epic-goal-progress_tokens'], [class*='tokens']");
            for (const el of tokenElements) {
              if (el.innerText && el.innerText.includes('tk')) {
                const match = el.innerText.match(/(\d+)\s*tk/);
                if (match && match[1]) {
                  goal.tokenAmount = parseInt(match[1], 10);
                  break;
                }
              }
            }
          }
        } catch (e) {
          console.error("Error extracting goal info:", e);
        }

        info.goal = goal;
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