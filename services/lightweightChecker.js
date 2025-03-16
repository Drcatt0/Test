/**
 * Lightweight Status Checker Service
 * Provides ultra-lightweight checks and caching for streamer status
 * WITH ENHANCED GOAL DETECTION
 */
const https = require('https');
const http = require('http');
const url = require('url');
const browserService = require('./browserService');

// Cache with time-based invalidation
const statusCache = new Map();

// Cache TTL values (in milliseconds)
const ONLINE_CACHE_TTL = 2 * 60 * 1000;  // 2 minutes for online streamers
const OFFLINE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes for offline streamers
const CACHE_CLEANUP_INTERVAL = 10 * 60 * 1000; // 10 minutes

// Start cache cleanup interval
setInterval(() => {
  cleanupCache();
}, CACHE_CLEANUP_INTERVAL);

/**
 * Get cached status or fetch new status
 * @param {string} username - Streamer username
 * @param {Object} options - Options for the check
 * @returns {Promise<Object>} Status information
 */
async function getCachedStatus(username, options = {}) {
  const normalizedUsername = username.toLowerCase();
  const now = Date.now();
  
  // Default options
  const defaultOptions = {
    forceRefresh: false,
    maxAge: null,
    includeGoal: true
  };
  
  // Merge with provided options
  const finalOptions = { ...defaultOptions, ...options };
  
  // Skip cache if force refresh requested
  if (finalOptions.forceRefresh) {
    console.log(`Force refreshing status for ${username}`);
    return await updateCache(normalizedUsername, finalOptions);
  }
  
  // Check if we have a cached status
  if (statusCache.has(normalizedUsername)) {
    const cachedData = statusCache.get(normalizedUsername);
    
    // Determine max age for this cache entry
    const maxAge = finalOptions.maxAge || (cachedData.data.isLive ? ONLINE_CACHE_TTL : OFFLINE_CACHE_TTL);
    
    // If cache is still valid, use it
    if (now - cachedData.timestamp < maxAge) {
      console.log(`Using cached status for ${username} (${Math.round((now - cachedData.timestamp)/1000)}s old)`);
      return cachedData.data;
    }
    
    console.log(`Cache expired for ${username}, fetching fresh data`);
  }
  
  // No valid cache, fetch fresh data
  return await updateCache(normalizedUsername, finalOptions);
}

/**
 * Update the cache with fresh status data
 */
async function updateCache(username, options = {}) {
  try {
    let status;
    
    // Choose method based on options - use ultra lightweight if we don't need goal info
    if (!options.includeGoal) {
      status = await httpStreamCheck(username);
    } else {
      // If we need goal info, first do a quick check to see if live
      const quickStatus = await httpStreamCheck(username);
      
      if (!quickStatus.isLive) {
        // If not live, no need for goal info
        status = quickStatus;
      } else {
        // If live, get detailed info with goals
        status = await getLiveStreamerInfo(username);
      }
    }
    
    // Store in cache
    statusCache.set(username, {
      timestamp: Date.now(),
      data: status
    });
    
    return status;
  } catch (error) {
    console.error(`Error updating cache for ${username}:`, error);
    
    // If we have an old cache, return it as fallback
    if (statusCache.has(username)) {
      const oldCache = statusCache.get(username);
      console.log(`Using stale cache as fallback for ${username}`);
      return oldCache.data;
    }
    
    // Otherwise return a default offline status
    return {
      isLive: false,
      goal: { active: false, progress: 0, text: '', completed: false },
      nextBroadcast: null
    };
  }
}

/**
 * Clean up old cache entries
 */
function cleanupCache(maxAgeMs = 30 * 60 * 1000) { // Default 30 minutes
  const now = Date.now();
  let cleaned = 0;
  
  for (const [username, cacheEntry] of statusCache.entries()) {
    if (now - cacheEntry.timestamp > maxAgeMs) {
      statusCache.delete(username);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`Cleaned ${cleaned} old cache entries`);
  }
  
  return cleaned;
}

/**
 * Check if a streamer is live using only HTTP requests
 * Much more network-efficient than browser-based checks
 * @param {string} username - Streamer username
 * @returns {Promise<Object>} Status information
 */
async function httpStreamCheck(username) {
  try {
    // First check profile page with a GET request to look for live badge
    const profileReq = await makeRequest({
      hostname: 'stripchat.com',
      path: `/${username}/profile?_=${Date.now()}`,
      method: 'GET',
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html',
        'Cache-Control': 'no-cache'
      }
    });
    
    // If profile 404s, user doesn't exist
    if (profileReq.statusCode === 404) {
      return { 
        exists: false, 
        isLive: false,
        goal: { active: false, progress: 0, text: '', completed: false },
        nextBroadcast: null
      };
    }
    
    // Check if the HTML contains live indicators
    const html = profileReq.data || '';
    const isLive = html.includes('live-badge') || 
                  html.includes('>LIVE<') || 
                  html.includes('is-live') ||
                  html.includes('isLive":true');
    
    // Extract next broadcast time if not live
    let nextBroadcast = null;
    if (!isLive && html) {
      // Simple regex to find next broadcast info
      const broadcastMatch = html.match(/next-broadcast[^>]*>(.*?)<\/div/);
      if (broadcastMatch && broadcastMatch[1]) {
        nextBroadcast = broadcastMatch[1].replace(/<[^>]*>/g, ' ').trim();
      }
    }
    
    return { 
      exists: true, 
      isLive, 
      nextBroadcast,
      goal: { active: false, progress: 0, text: '', completed: false }
    };
  } catch (error) {
    console.error(`HTTP check error for ${username}:`, error.message);
    return { 
      exists: null, 
      isLive: false, 
      goal: { active: false, progress: 0, text: '', completed: false },
      nextBroadcast: null
    };
  }
}

/**
 * Get detailed information for a live streamer including goals
 * This performs an HTTP request that looks for goal information in the HTML
 */
async function getLiveStreamerInfo(username) {
  try {
    // Request the main page to get goal information
    const mainPageReq = await makeRequest({
      hostname: 'stripchat.com',
      path: `/${username}?_=${Date.now()}`, 
      method: 'GET',
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html',
        'Cache-Control': 'no-cache'
      }
    });
    
    const html = mainPageReq.data || '';
    
    // Explicitly check if they're live
    const isLive = html.includes('live-badge') || 
                  html.includes('>LIVE<') || 
                  html.includes('is-live') ||
                  html.includes('isLive":true');
    
    // Default goal info
    let goalInfo = {
      active: false,
      progress: 0,
      text: '',
      completed: false
    };
    
    // Check for goal information
    if (isLive) {
      // Look for progress bar indicators
      const progressBarPattern = /progress(?:bar)?[^>]*style="[^"]*width:\s*(\d+\.?\d*)%/;
      const progressMatch = html.match(progressBarPattern);
      if (progressMatch && progressMatch[1]) {
        goalInfo.active = true;
        goalInfo.progress = parseFloat(progressMatch[1]);
      }
      
      // Alternative progress detection
      if (!goalInfo.active) {
        const ariaNowPattern = /role="progressbar"[^>]*aria-valuenow="(\d+\.?\d*)"/;
        const ariaMatch = html.match(ariaNowPattern);
        if (ariaMatch && ariaMatch[1]) {
          goalInfo.active = true;
          goalInfo.progress = parseFloat(ariaMatch[1]);
        }
      }
      
      // Another alternative - percentages in text
      if (!goalInfo.active) {
        const percentPattern = /(\d+\.?\d*)%\s*(?:complete|done)/i;
        const percentMatch = html.match(percentPattern);
        if (percentMatch && percentMatch[1]) {
          goalInfo.active = true;
          goalInfo.progress = parseFloat(percentMatch[1]);
        }
      }
      
      // Look for goal text
      if (goalInfo.active) {
        // Extract tokens amount
        const tokenMatch = html.match(/epic-goal-progress__tokens[^>]*>(\d+)\s*tk</i);
        if (tokenMatch && tokenMatch[1]) {
          goalInfo.tokenAmount = parseInt(tokenMatch[1], 10);
        }
        
        // Try different patterns to find goal text
        const goalTextPatterns = [
          /goal[^:]*:\s*([^<]+)/i,
          /goal-text[^>]*>([^<]+)</i,
          /goal_text[^>]*>([^<]+)</i,
          /goal-information[^>]*>([^<]+)</i,
          /<span[^>]*>([^<]+)<\/span>\s*<\/span>\s*<\/div>/i
        ];
        
        for (const pattern of goalTextPatterns) {
          const match = html.match(pattern);
          if (match && match[1] && match[1].trim() && !match[1].includes('tk')) {
            goalInfo.text = match[1].trim();
            break;
          }
        }
        
        // If no text found, try another approach by looking at content between spans
        if (!goalInfo.text) {
          const spanMatches = html.match(/<span[^>]*epic-goal-progress__tokens[^>]*>[\d\s]+tk<\/span>\s*<span[^>]*>\s*([^<]+)\s*<\/span>/i);
          if (spanMatches && spanMatches[1]) {
            goalInfo.text = spanMatches[1].trim();
          }
        }
        
        // Sanitize the goal text
        goalInfo.text = sanitizeGoalText(goalInfo.text);
        
        // Mark as completed if progress is at or near 100%
        goalInfo.completed = goalInfo.progress >= 95;
      }
    }
    
    return {
      exists: true,
      isLive,
      goal: goalInfo,
      nextBroadcast: null
    };
  } catch (error) {
    console.error(`Error getting live streamer info for ${username}:`, error.message);
    return {
      exists: true,
      isLive: true, // We already know they're live from the first check
      goal: { active: false, progress: 0, text: '', completed: false },
      nextBroadcast: null
    };
  }
}

/**
 * Make an HTTP/HTTPS request with proper error handling
 */
async function makeRequest(options) {
  return new Promise((resolve, reject) => {
    // Set defaults
    options.timeout = options.timeout || 10000; // 10 second timeout
    
    // Choose HTTP module based on protocol
    const protocol = options.protocol || 'https:';
    const httpModule = protocol === 'https:' ? https : http;
    
    // Create the request
    const req = httpModule.request(options, (res) => {
      // Handle redirects
      if (res.statusCode === 301 || res.statusCode === 302) {
        if (res.headers.location) {
          // Parse the redirect URL
          const redirectUrl = new URL(
            res.headers.location,
            `${protocol}//${options.hostname}`
          );
          
          // Create new options for the redirect
          const redirectOptions = {
            protocol: redirectUrl.protocol,
            hostname: redirectUrl.hostname,
            path: redirectUrl.pathname + redirectUrl.search,
            method: options.method,
            headers: options.headers,
            timeout: options.timeout
          };
          
          // Follow the redirect
          makeRequest(redirectOptions)
            .then(resolve)
            .catch(reject);
          return;
        }
      }
      
      // For successful responses, gather the data
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data
        });
      });
    });
    
    // Error handling
    req.on('error', reject);
    
    // Timeout handling
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
    
    // End the request
    req.end();
  });
}

/**
 * Get a random user agent string
 */
function getRandomUserAgent() {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0'
  ];
  
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

// Sanitize extracted goal text to remove JavaScript code
function sanitizeGoalText(text) {
  // If text is empty, return generic text
  if (!text) return "Goal in progress";
  
  // Check if text looks like JavaScript or HTML code
  if (text.includes('function') || 
      text.includes('var ') || 
      text.includes('const ') || 
      text.includes('window.') ||
      text.includes('document.') ||
      text.includes('svg') ||
      text.includes('<') ||
      text.includes('=') ||
      text.length > 100) {
    console.log("Detected code in goal text, replacing with generic text");
    return "Special Goal";
  }
  
  // Remove any HTML tags, whitespace, and trim
  text = text.replace(/<[^>]*>/g, '').trim();
  text = text.replace(/\s+/g, ' ');
  
  // Convert common whitespace markers to actual spaces
  if (text === "(whitespace)") return "Topless";
  
  return text;
}

module.exports = {
  getCachedStatus,
  updateCache,
  cleanupCache,
  httpStreamCheck,
  getLiveStreamerInfo
};