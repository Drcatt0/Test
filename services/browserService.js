/**
 * Optimized Browser Pool Service for Reduced Network Usage
 */
const puppeteer = require('puppeteer');
const config = require('../config/config');

// Browser pool
const browserPool = [];
const maxPoolSize = config.BROWSER_POOL_SIZE || 3;
const inUse = new Set();
let lastBrowserActivity = {};

// User agent rotation to prevent blocking
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

/**
 * Get a random user agent
 */
function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Get a browser from the pool or create a new one
 */
async function getBrowser() {
  try {
    // Check if there's an available browser in the pool
    const availableBrowser = browserPool.find(browser => !inUse.has(browser));
    
    if (availableBrowser) {
      console.log("Reusing existing browser from pool");
      inUse.add(availableBrowser);
      lastBrowserActivity[availableBrowser] = Date.now();
      return availableBrowser;
    }
    
    // If pool is not full, create a new browser
    if (browserPool.length < maxPoolSize) {
      console.log(`Creating new browser instance (pool: ${browserPool.length}/${maxPoolSize})`);
      const browser = await puppeteer.launch({
        executablePath: '/usr/bin/chromium-browser',
        headless: true,
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox',
          '--disable-features=IsolateOrigins',
          '--disable-site-isolation-trials',
          '--disable-web-security',
          '--disable-gpu',
          '--disable-dev-shm-usage',
          '--js-flags=--max-old-space-size=256'
        ],
        defaultViewport: { width: 1280, height: 720 }
      });
      
      browserPool.push(browser);
      inUse.add(browser);
      lastBrowserActivity[browser] = Date.now();
      
      // Set up event listeners to handle browser disconnection
      browser.on('disconnected', () => {
        console.log("Browser disconnected, removing from pool");
        const index = browserPool.indexOf(browser);
        if (index > -1) {
          browserPool.splice(index, 1);
          inUse.delete(browser);
          delete lastBrowserActivity[browser];
        }
      });
      
      return browser;
    }
    
    // All browsers are in use, wait for one to become available or timeout
    console.log("All browsers in use, waiting for one to become available");
    
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const availableBrowser = browserPool.find(browser => !inUse.has(browser));
        if (availableBrowser) {
          clearInterval(checkInterval);
          inUse.add(availableBrowser);
          lastBrowserActivity[availableBrowser] = Date.now();
          resolve(availableBrowser);
        }
      }, 500);
      
      // Set a timeout to prevent indefinite waiting
      setTimeout(() => {
        clearInterval(checkInterval);
        console.log("Timeout waiting for browser, creating new instance");
        
        // Force close the least recently used browser if at capacity
        if (browserPool.length >= maxPoolSize) {
          const oldestBrowser = findLeastRecentlyUsedBrowser();
          if (oldestBrowser) {
            const index = browserPool.indexOf(oldestBrowser);
            if (index > -1) {
              browserPool.splice(index, 1);
              inUse.delete(oldestBrowser);
              oldestBrowser.close().catch(e => console.error("Error closing old browser:", e));
              delete lastBrowserActivity[oldestBrowser];
            }
          }
        }
        
        puppeteer.launch({
          executablePath: '/usr/bin/chromium-browser',
          headless: true,
          args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-features=IsolateOrigins',
            '--disable-site-isolation-trials',
            '--disable-web-security',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--js-flags=--max-old-space-size=256'
          ],
          defaultViewport: { width: 1280, height: 720 }
        }).then(browser => {
          browserPool.push(browser);
          inUse.add(browser);
          lastBrowserActivity[browser] = Date.now();
          
          // Set up event listener for disconnection
          browser.on('disconnected', () => {
            console.log("Browser disconnected, removing from pool");
            const index = browserPool.indexOf(browser);
            if (index > -1) {
              browserPool.splice(index, 1);
              inUse.delete(browser);
              delete lastBrowserActivity[browser];
            }
          });
          
          resolve(browser);
        }).catch(err => {
          console.error("Error creating browser:", err);
          resolve(null);
        });
      }, 10000);
    });
  } catch (error) {
    console.error("Error getting browser:", error);
    return null;
  }
}

/**
 * Find the least recently used browser
 */
function findLeastRecentlyUsedBrowser() {
  let oldestTime = Infinity;
  let oldestBrowser = null;
  
  for (const browser of browserPool) {
    const lastUsed = lastBrowserActivity[browser] || 0;
    if (lastUsed < oldestTime) {
      oldestTime = lastUsed;
      oldestBrowser = browser;
    }
  }
  
  return oldestBrowser;
}

/**
 * Release a browser back to the pool
 */
function releaseBrowser(browser) {
  if (!browser) return;
  
  try {
    inUse.delete(browser);
    lastBrowserActivity[browser] = Date.now();
    console.log(`Browser released to pool (${inUse.size}/${browserPool.length} in use)`);
  } catch (e) {
    console.error('Error releasing browser:', e);
  }
}

/**
 * Cleanup inactive browsers to reduce memory usage
 */
function cleanupBrowsers() {
  let count = 0;
  const now = Date.now();
  const inactivityThreshold = config.BROWSER_INACTIVITY_TIMEOUT || 5 * 60 * 1000; // 5 minutes
  
  // Close any browsers that have been inactive for too long
  for (let i = browserPool.length - 1; i >= 0; i--) {
    const browser = browserPool[i];
    const lastUsed = lastBrowserActivity[browser] || 0;
    
    if (!inUse.has(browser) && (now - lastUsed > inactivityThreshold)) {
      try {
        browser.close().catch(e => console.error('Error closing browser:', e));
        browserPool.splice(i, 1);
        delete lastBrowserActivity[browser];
        count++;
        console.log(`Closed inactive browser (inactive for ${Math.round((now - lastUsed)/1000)}s)`);
      } catch (e) {
        console.error('Error closing browser:', e);
      }
    }
  }
  
  return count;
}

/**
 * Close all browsers
 */
async function closeBrowser() {
  for (const browser of browserPool) {
    try {
      await browser.close().catch(e => console.error('Error closing browser:', e));
    } catch (e) {
      console.error('Error closing browser:', e);
    }
  }
  
  browserPool.length = 0;
  inUse.clear();
  lastBrowserActivity = {};
  console.log("All browsers closed");
}

/**
 * Reset browser pool - force close all and start fresh
 */
async function resetBrowserPool() {
  await closeBrowser();
  console.log("Browser pool reset");
}

/**
 * Quick check for stream status without using a full browser
 * Uses simple HTTP requests which are much lighter than browser automation
 */
async function quickStreamCheck(username) {
  try {
    const https = require('https');
    // This is a lightweight check that just makes an HTTP request
    // without loading a full browser, saving significant resources
    
    return new Promise((resolve) => {
      const options = {
        hostname: 'stripchat.com',
        path: `/${username}`,
        method: 'HEAD',
        timeout: 10000,
        headers: {
          'User-Agent': getRandomUserAgent()
        }
      };
      
      const req = https.request(options, (res) => {
        // If we get a 200 response, the user exists
        // We'll need to check for redirects to determine live status
        const exists = res.statusCode === 200;
        
        // Check for specific headers that might indicate live status
        const isLive = exists && (
          res.headers['x-stream-status'] === 'live' || 
          res.headers.location?.includes('live')
        );
        
        resolve({ exists, isLive, statusCode: res.statusCode });
      });
      
      req.on('error', (error) => {
        console.error(`Error in quickStreamCheck for ${username}:`, error.message);
        resolve({ exists: false, isLive: false, error: error.message });
      });
      
      req.on('timeout', () => {
        req.destroy();
        resolve({ exists: false, isLive: false, error: 'timeout' });
      });
      
      req.end();
    });
  } catch (error) {
    console.error(`Error in quickStreamCheck for ${username}:`, error);
    return { exists: false, isLive: false, error: error.message };
  }
}

/**
 * Create a browser page preconfigured to minimize network usage
 */
async function createOptimizedPage(browser) {
  try {
    if (!browser) {
      console.error("Cannot create optimized page: No browser provided");
      return null;
    }
    
    const page = await browser.newPage();
    
    // Set random user agent
    await page.setUserAgent(getRandomUserAgent());
    
    // Enable request interception for aggressive resource blocking
    await page.setRequestInterception(true);
    
    // Block images, stylesheets, fonts and other non-essential resources
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      const url = req.url();
      
      // Only allow essential requests
      if (['document', 'xhr', 'fetch'].includes(resourceType)) {
        // For these types, only allow essential domains
        if (url.includes('stripchat.com') || 
            url.includes('doppiocdn.com') || 
            url.includes('stripcdn.com')) {
          req.continue();
        } else {
          req.abort();
        }
      } else {
        // Block all other resource types
        req.abort();
      }
    });
    
    // Set shorter timeout
    await page.setDefaultNavigationTimeout(15000);
    
    // Disable JavaScript - extreme measure to save bandwidth if needed
    // Uncomment to reduce bandwidth even further, but might break functionality
    // await page.setJavaScriptEnabled(false);
    
    return page;
  } catch (error) {
    console.error("Error creating optimized page:", error);
    return null;
  }
}

module.exports = {
  getBrowser,
  releaseBrowser,
  cleanupBrowsers,
  closeBrowser,
  resetBrowserPool,
  getRandomUserAgent,
  quickStreamCheck,
  createOptimizedPage
};