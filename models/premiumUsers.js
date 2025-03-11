/**
 * Premium Users Data Model
 */
const fs = require('fs-extra');
const config = require('../config/config');

// In-memory storage
let premiumUsers = {};

/**
 * Load premium users from JSON file
 */
async function loadPremiumUsers() {
  try {
    const data = await fs.readFile(config.PREMIUM_USERS_PATH, 'utf-8');
    premiumUsers = JSON.parse(data);
    
    // Clean up expired premium users
    const now = new Date();
    let changes = false;
    
    for (const [userId, data] of Object.entries(premiumUsers)) {
      if (new Date(data.expiresAt) < now) {
        delete premiumUsers[userId];
        changes = true;
      }
    }
    
    if (changes) {
      await savePremiumUsers();
    }
    
    console.log(`Loaded ${Object.keys(premiumUsers).length} premium users`);
  } catch (error) {
    console.log("No existing premiumUsers.json found. Starting fresh.");
    premiumUsers = {};
    await savePremiumUsers();
  }
  return premiumUsers;
}

/**
 * Save premium users to JSON file
 */
async function savePremiumUsers() {
  try {
    await fs.writeFile(config.PREMIUM_USERS_PATH, JSON.stringify(premiumUsers, null, 2));
    return true;
  } catch (error) {
    console.error("Error saving premiumUsers.json:", error);
    return false;
  }
}

/**
 * Check if a user has premium status
 */
function isPremiumUser(userId) {
  const userIdStr = userId.toString();
  if (!premiumUsers[userIdStr]) return false;
  
  const now = new Date();
  const expiresAt = new Date(premiumUsers[userIdStr].expiresAt);
  
  // Check if premium has expired
  if (now > expiresAt) {
    // Premium expired, clean up
    delete premiumUsers[userIdStr];
    savePremiumUsers();
    return false;
  }
  
  return true;
}

/**
 * Add a premium user
 */
async function addPremiumUser(userId, username, key) {
  const userIdStr = userId.toString();
  const expiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now
  
  premiumUsers[userIdStr] = {
    username: username || 'Unknown',
    activatedAt: new Date().toISOString(),
    expiresAt: expiryDate.toISOString(),
    key: key
  };
  
  await savePremiumUsers();
  return {
    success: true,
    expiryDate: expiryDate
  };
}

/**
 * Get premium user details
 */
function getPremiumUserDetails(userId) {
  const userIdStr = userId.toString();
  if (!premiumUsers[userIdStr]) return null;
  
  return {
    ...premiumUsers[userIdStr],
    expiresAt: new Date(premiumUsers[userIdStr].expiresAt)
  };
}

/**
 * Validate a premium key
 */
function validatePremiumKey(key) {
  // In a real implementation, this would check against a secure database
  const validKey = config.PREMIUM_KEYS[key];
  
  if (validKey && !validKey.used) {
    return {
      valid: true,
      key: key
    };
  }
  
  return {
    valid: false
  };
}

/**
 * Mark a premium key as used
 */
function markKeyAsUsed(key) {
  if (config.PREMIUM_KEYS[key]) {
    config.PREMIUM_KEYS[key].used = true;
    return true;
  }
  return false;
}

module.exports = {
  loadPremiumUsers,
  savePremiumUsers,
  isPremiumUser,
  addPremiumUser,
  getPremiumUserDetails,
  validatePremiumKey,
  markKeyAsUsed
};
