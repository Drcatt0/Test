/**
 * Browser management service - Simplified for better reliability
 */
const puppeteer = require('puppeteer');
const config = require('../config/config');

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
 * Get a browser - simplified approach that creates a fresh instance every time
 * This is less efficient but more reliable
 */
async function getBrowser() {
  try {
    console.log("Creating new browser instance");
    const browser = await puppeteer.launch({
      executablePath: '/usr/bin/chromium-browser',
      headless: true,
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-features=IsolateOrigins',
        '--disable-site-isolation-trials',
        '--disable-web-security'  // Helps with CORS issues
      ],
      defaultViewport: { width: 1280, height: 720 }
    });
    
    return browser;
  } catch (error) {
    console.error("Error creating browser:", error);
    return null;
  }
}

/**
 * Release a browser - always closes it for reliability
 */
function releaseBrowser(browser) {
  if (!browser) return;
  
  try {
    browser.close();
    console.log('Browser closed');
  } catch (e) {
    console.error('Error closing browser:', e);
  }
}

/**
 * Simple browser pool cleanup - no pooling in this simplified version
 */
function cleanupBrowsers() {
  // No browser pool to clean
  return 0;
}

/**
 * Force close all browsers
 */
async function closeBrowser() {
  // Nothing to do in the simplified version
  console.log("closeBrowser called - no pooled browsers to close");
}

/**
 * Reset browser handling
 */
async function resetBrowserPool() {
  // Nothing to do in the simplified version
  console.log("resetBrowserPool called - no pool to reset");
}

module.exports = {
  getBrowser,
  releaseBrowser,
  cleanupBrowsers,
  closeBrowser,
  resetBrowserPool,
  getRandomUserAgent
};