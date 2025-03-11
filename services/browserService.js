/**
 * Browser management service
 */
const puppeteer = require('puppeteer');
const config = require('../config/config');

// Browser state
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
      if (!browserInUse && Date.now() - lastBrowserActivity > config.BROWSER_INACTIVITY_TIMEOUT) {
        // Close the browser if it's been inactive for over the timeout period
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
        args: config.BROWSER_ARGS,
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
 * Force close the browser
 */
async function closeBrowser() {
  if (sharedBrowser) {
    try {
      await sharedBrowser.close();
      sharedBrowser = null;
      console.log('Browser closed successfully');
    } catch (error) {
      console.error('Error closing browser:', error);
      sharedBrowser = null;
    }
  }
}

module.exports = {
  getBrowser,
  releaseBrowser,
  closeBrowser
};
