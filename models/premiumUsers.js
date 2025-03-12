/**
 * Premium Users Data Model
 */
const fs = require('fs-extra');
const path = require('path'); // Added this import
const config = require('../config/config');

// In-memory storage
let premiumUsers = {};

/**
 * Load premium users from JSON file
 */
async function loadPremiumUsers() {
  try {
    console.log(`📂 Checking for premium users file at ${config.PREMIUM_USERS_PATH}`);
    
    // Check if the file exists first
    if (!await fs.pathExists(config.PREMIUM_USERS_PATH)) {
      console.log(`⚠️ File not found: ${config.PREMIUM_USERS_PATH}. Creating a new one.`);
      premiumUsers = {};
      await savePremiumUsers();
      return premiumUsers;
    }

    // Read the file
    const rawData = await fs.readFile(config.PREMIUM_USERS_PATH, 'utf-8');
    console.log(`📄 Read ${rawData.length} bytes from premium users file`);
    
    if (!rawData || rawData.trim() === '') {
      console.log("⚠️ Premium users file is empty. Starting fresh.");
      premiumUsers = {};
      await savePremiumUsers();
      return premiumUsers;
    }
    
    try {
      const parsedData = JSON.parse(rawData);
      console.log(`🔍 Successfully parsed premium users JSON data`);
      
      if (typeof parsedData === 'object' && parsedData !== null) {
        premiumUsers = parsedData;
        
        // Convert date strings to Date objects for easier handling
        for (const userId in premiumUsers) {
          if (premiumUsers[userId].activatedAt) {
            premiumUsers[userId].activatedAt = new Date(premiumUsers[userId].activatedAt).toISOString();
          }
          if (premiumUsers[userId].expiresAt) {
            premiumUsers[userId].expiresAt = new Date(premiumUsers[userId].expiresAt).toISOString();
          }
        }
        
        // Clean up expired premium users
        const now = new Date();
        let changes = false;
        
        for (const [userId, userData] of Object.entries(premiumUsers)) {
          if (!userData.expiresAt) {
            console.log(`⚠️ User ${userId} has no expiry date, removing`);
            delete premiumUsers[userId];
            changes = true;
            continue;
          }
          
          try {
            const expiryDate = new Date(userData.expiresAt);
            if (expiryDate < now) {
              console.log(`⏱️ User ${userId} premium expired on ${expiryDate.toISOString()}`);
              delete premiumUsers[userId];
              changes = true;
            } else {
              console.log(`✅ User ${userId} has premium until ${expiryDate.toISOString()}`);
            }
          } catch (dateError) {
            console.error(`❌ Invalid expiry date for user ${userId}:`, dateError.message);
            delete premiumUsers[userId];
            changes = true;
          }
        }
        
        if (changes) {
          console.log("📝 Changes made to premium users data, saving...");
          await savePremiumUsers();
        }
        
        console.log(`✅ Loaded ${Object.keys(premiumUsers).length} premium users`);
      } else {
        console.error("❌ Premium users JSON data is not an object as expected");
        premiumUsers = {};
      }
    } catch (parseError) {
      console.error("❌ Error parsing premium users JSON:", parseError.message);
      // Backup the corrupted file
      const backupPath = `${config.PREMIUM_USERS_PATH}.corrupt.${Date.now()}`;
      await fs.copy(config.PREMIUM_USERS_PATH, backupPath);
      console.log(`📋 Backed up corrupted file to ${backupPath}`);
      
      premiumUsers = {};
    }

    // Always save to ensure consistent format
    await savePremiumUsers();
    return premiumUsers;
  } catch (error) {
    console.error("❌ Error loading premium users:", error.message, error.stack);
    premiumUsers = {};
    await savePremiumUsers();
    return premiumUsers;
  }
}

/**
 * Save premium users to JSON file
 */
async function savePremiumUsers() {
  try {
    // Ensure directory exists
    const dir = path.dirname(config.PREMIUM_USERS_PATH);
    await fs.ensureDir(dir);
    
    console.log(`💾 Saving ${Object.keys(premiumUsers).length} premium users to ${config.PREMIUM_USERS_PATH}`);
    
    // Create a copy of the data for saving
    const dataToSave = JSON.stringify(premiumUsers, null, 2);
    
    // Use atomic write pattern - write to temp file then rename
    const tempFile = `${config.PREMIUM_USERS_PATH}.tmp`;
    await fs.writeFile(tempFile, dataToSave, 'utf8');
    
    // Verify the file was written
    if (!await fs.pathExists(tempFile)) {
      throw new Error(`Failed to write temp file: ${tempFile}`);
    }
    
    await fs.rename(tempFile, config.PREMIUM_USERS_PATH);
    
    console.log("✅ Premium users data saved successfully");
    return true;
  } catch (error) {
    console.error("❌ Error saving premium users:", error.message, error.stack);
    return false;
  }
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