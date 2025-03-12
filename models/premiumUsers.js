/**
 * Premium Users Data Model
 */
const fs = require('fs-extra');
const path = require('path'); // Add this line
const config = require('../config/config');

// In-memory storage
let premiumUsers = {};

// In models/premiumUsers.js, modify these functions:

/**
 * Load premium users from JSON file
 */
async function loadPremiumUsers() {
  try {
    console.log(`Attempting to load premium users from ${config.PREMIUM_USERS_PATH}`);
    
    // First check if the file exists
    if (!fs.existsSync(config.PREMIUM_USERS_PATH)) {
      console.log("Premium users file does not exist. Creating a new one.");
      premiumUsers = {};
      await savePremiumUsers();
      return premiumUsers;
    }
    
    const data = await fs.readFile(config.PREMIUM_USERS_PATH, 'utf-8');
    
    if (!data || data.trim() === '') {
      console.log("Premium users file is empty. Starting fresh.");
      premiumUsers = {};
      await savePremiumUsers();
      return premiumUsers;
    }
    
    try {
      premiumUsers = JSON.parse(data);
      console.log("Successfully parsed premium users data");
    } catch (parseError) {
      console.error("Error parsing premium users JSON:", parseError);
      // If we can't parse the file, back it up and start fresh
      const backupPath = `${config.PREMIUM_USERS_PATH}.backup-${Date.now()}`;
      await fs.copyFile(config.PREMIUM_USERS_PATH, backupPath);
      console.log(`Backed up corrupt file to ${backupPath}`);
      premiumUsers = {};
    }
    
    // Convert string keys to ensure consistency
    const cleanedData = {};
    for (const [key, value] of Object.entries(premiumUsers)) {
      cleanedData[key.toString()] = value;
    }
    premiumUsers = cleanedData;
    
    // Clean up expired premium users
    const now = new Date();
    let changes = false;
    
    for (const [userId, data] of Object.entries(premiumUsers)) {
      if (!data.expiresAt) {
        delete premiumUsers[userId];
        changes = true;
        continue;
      }
      
      try {
        if (new Date(data.expiresAt) < now) {
          console.log(`User ${userId} premium has expired`);
          delete premiumUsers[userId];
          changes = true;
        } else {
          console.log(`User ${userId} has premium until ${data.expiresAt}`);
        }
      } catch (dateError) {
        console.error(`Invalid expiry date for user ${userId}:`, dateError);
        // Fix the expiry date if possible, otherwise remove
        if (typeof data.activatedAt === 'string' && data.activatedAt) {
          try {
            const activatedDate = new Date(data.activatedAt);
            data.expiresAt = new Date(activatedDate.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
            changes = true;
          } catch (e) {
            delete premiumUsers[userId];
            changes = true;
          }
        } else {
          delete premiumUsers[userId];
          changes = true;
        }
      }
    }
    
    if (changes) {
      console.log("Changes made to premium users data, saving...");
      await savePremiumUsers();
    }
    
    console.log(`Loaded ${Object.keys(premiumUsers).length} premium users`);
  } catch (error) {
    console.error("Error loading premium users:", error);
    console.log("Starting with empty premium users data");
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
    // Ensure directory exists
    const dir = path.dirname(config.PREMIUM_USERS_PATH);
    await fs.ensureDir(dir);
    
    console.log(`Saving ${Object.keys(premiumUsers).length} premium users to ${config.PREMIUM_USERS_PATH}`);
    
    // Create a copy of the data for saving
    const dataToSave = JSON.stringify(premiumUsers, null, 2);
    
    // Use atomic write pattern - write to temp file then rename
    const tempFile = `${config.PREMIUM_USERS_PATH}.tmp`;
    await fs.writeFile(tempFile, dataToSave, 'utf8');
    await fs.rename(tempFile, config.PREMIUM_USERS_PATH);
    
    console.log("Premium users data saved successfully");
    return true;
  } catch (error) {
    console.error("Error saving premium users:", error);
    return false;
  }
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
  
  console.log(`Added premium user ${userIdStr} with expiry date ${expiryDate.toISOString()}`);
  
  const saveResult = await savePremiumUsers();
  if (!saveResult) {
    console.error(`Failed to save premium status for user ${userIdStr}`);
  }
  
  return {
    success: saveResult,
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
module.exports = {
  loadPremiumUsers,
  isPremiumUser,
  addPremiumUser,
  getPremiumUserDetails,
  validatePremiumKey,
  markKeyAsUsed
};