/**
 * Browser management service
 */
const puppeteer = require('puppeteer');
const config = require('../config/config');

// Browser pool for concurrent operations
const browserPool = {
  instances: [],
  maxSize: config.BROWSER_POOL_SIZE || 3,
  inUse: 0
};

/**
 * Get a browser from the pool or create a new one
 */
async function getBrowser() {
  try {
    // Check if we have an available browser in the pool
    for (let i = 0; i < browserPool.instances.length; i++) {
      const browser = browserPool.instances[i];
      if (browser && browser.connected && !browser.inUse) {
        browser.inUse = true;
        browserPool.inUse++;
        console.log(`Using existing browser instance #${i+1}. Active browsers: ${browserPool.inUse}/${browserPool.instances.length}`);
        return browser;
      }
    }
    
    // If we're below max pool size, create a new browser
    if (browserPool.instances.length < browserPool.maxSize) {
      const browser = await puppeteer.launch({
        executablePath: '/usr/bin/chromium-browser',
        headless: true,
        args: config.BROWSER_ARGS,
        defaultViewport: { width: 1280, height: 720 }
      });
      
      browser.inUse = true;
      browser.lastActivity = Date.now();
      
      // Set up close handler
      browser.on('disconnected', () => {
        const index = browserPool.instances.indexOf(browser);
        if (index !== -1) {
          browserPool.instances.splice(index, 1);
          if (browser.inUse) browserPool.inUse--;
          console.log('Browser disconnected from pool');
        }
      });
      
      browserPool.instances.push(browser);
      browserPool.inUse++;
      
      console.log(`Created new browser instance #${browserPool.instances.length}. Active browsers: ${browserPool.inUse}/${browserPool.instances.length}`);
      return browser;
    }
    
    // If we're at max capacity, wait for a browser to be released
    console.log('Waiting for an available browser...');
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        for (let i = 0; i < browserPool.instances.length; i++) {
          const browser = browserPool.instances[i];
          if (browser && browser.connected && !browser.inUse) {
            browser.inUse = true;
            browserPool.inUse++;
            clearInterval(checkInterval);
            resolve(browser);
            return;
          }
        }
      }, 500); // Check every 500ms
      
      // Set a timeout to avoid indefinite waiting
      setTimeout(() => {
        clearInterval(checkInterval);
        // If we time out, launch a new browser anyway
        puppeteer.launch({
          executablePath: '/usr/bin/chromium-browser',
          headless: true,
          args: config.BROWSER_ARGS,
          defaultViewport: { width: 1280, height: 720 }
        }).then(browser => {
          browser.inUse = true;
          browser.lastActivity = Date.now();
          
          // If we're over capacity, close the oldest browser later
          if (browserPool.instances.length >= browserPool.maxSize) {
            setTimeout(() => cleanupBrowsers(), 5000);
          }
          
          browserPool.instances.push(browser);
          browserPool.inUse++;
          resolve(browser);
        }).catch(err => {
          console.error("Error launching browser in timeout fallback:", err);
          // Try one more time with minimal options
          puppeteer.launch({
            executablePath: '/usr/bin/chromium-browser',
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
          }).then(resolve).catch(() => {
            // If this fails too, resolve with null and let the caller handle it
            resolve(null);
          });
        });
      }, 15000); // 15 second timeout
    });
  } catch (error) {
    console.error("Error getting browser from pool:", error);
    return null;
  }
}

/**
 * Release a browser back to the pool
 */
function releaseBrowser(browser) {
  if (!browser) return;
  
  // Find the browser in our pool
  const index = browserPool.instances.indexOf(browser);
  if (index === -1) return;
  
  browser.inUse = false;
  browser.lastActivity = Date.now();
  browserPool.inUse--;
  
  console.log(`Released browser. Active browsers: ${browserPool.inUse}/${browserPool.instances.length}`);
}

/**
 * Clean up inactive browser instances
 */
function cleanupBrowsers() {
  const now = Date.now();
  let closed = 0;
  
  // Start from the end to avoid index shifting issues during splicing
  for (let i = browserPool.instances.length - 1; i >= 0; i--) {
    const browser = browserPool.instances[i];
    
    // Skip browsers that are in use
    if (browser.inUse) continue;
    
    // Close browsers that have been inactive for too long
    if (now - browser.lastActivity > config.BROWSER_INACTIVITY_TIMEOUT) {
      try {
        browser.close();
        browserPool.instances.splice(i, 1);
        closed++;
      } catch (e) {
        console.error("Error closing inactive browser:", e);
        browserPool.instances.splice(i, 1);
      }
    }
  }
  
  if (closed > 0) {
    console.log(`Closed ${closed} inactive browsers`);
  }
  
  return closed;
}

// Start a cleaning interval
const cleanupInterval = setInterval(cleanupBrowsers, 2 * 60 * 1000); // Every 2 minutes

/**
 * Force close all browsers in the pool
 */
async function closeBrowser() {
  clearInterval(cleanupInterval);
  
  let closedCount = 0;
  for (const browser of browserPool.instances) {
    try {
      await browser.close();
      closedCount++;
    } catch (e) {
      console.error("Error closing browser during shutdown:", e);
    }
  }
  
  browserPool.instances = [];
  browserPool.inUse = 0;
  console.log(`All browsers closed (${closedCount})`);
}

module.exports = {
  getBrowser,
  releaseBrowser,
  cleanupBrowsers,
  closeBrowser
};