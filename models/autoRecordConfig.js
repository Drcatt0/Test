/**
 * Auto Record Configuration Data Model
 */
const fs = require('fs-extra');
const path = require('path'); // Added this import
const config = require('../config/config');

// In-memory storage
let autoRecordConfig = {};

/**
 * Load auto record config from JSON file
 */
async function loadAutoRecordConfig() {
  try {
    console.log(`📂 Checking for auto record config at ${config.AUTO_RECORD_CONFIG_PATH}`);
    
    // Check if the file exists first
    if (!await fs.pathExists(config.AUTO_RECORD_CONFIG_PATH)) {
      console.log(`⚠️ File not found: ${config.AUTO_RECORD_CONFIG_PATH}. Creating a new one.`);
      autoRecordConfig = {};
      await saveAutoRecordConfig();
      return autoRecordConfig;
    }

    // Read the file
    const rawData = await fs.readFile(config.AUTO_RECORD_CONFIG_PATH, 'utf-8');
    console.log(`📄 Read ${rawData.length} bytes from auto record config file`);
    
    if (!rawData || rawData.trim() === '') {
      console.log("⚠️ Auto record config file is empty. Starting fresh.");
      autoRecordConfig = {};
      await saveAutoRecordConfig();
      return autoRecordConfig;
    }
    
    try {
      const parsedData = JSON.parse(rawData);
      console.log(`🔍 Successfully parsed auto record config JSON data`);
      
      if (typeof parsedData === 'object' && parsedData !== null) {
        autoRecordConfig = parsedData;
        
        // Ensure each config has required fields
        for (const userId in autoRecordConfig) {
          const userConfig = autoRecordConfig[userId];
          
          // Ensure usernames array exists
          if (!userConfig.usernames || !Array.isArray(userConfig.usernames)) {
            console.log(`⚠️ Fixing missing usernames array for user ${userId}`);
            userConfig.usernames = [];
          }
          
          // Ensure chat ID exists and is a string
          if (!userConfig.chatId) {
            console.log(`⚠️ No chatId for user ${userId}, using userId as fallback`);
            userConfig.chatId = userId.toString();
          } else {
            userConfig.chatId = userConfig.chatId.toString();
          }
          
          // Ensure duration is valid
          if (!userConfig.duration || isNaN(userConfig.duration)) {
            console.log(`⚠️ Setting default duration for user ${userId}`);
            userConfig.duration = 180; // Default 3 minutes
          }
          
          // Ensure enabled flag exists
          if (userConfig.enabled === undefined) {
            console.log(`⚠️ Setting default enabled status for user ${userId}`);
            userConfig.enabled = false;
          }
        }
        
        console.log(`✅ Loaded auto record config for ${Object.keys(autoRecordConfig).length} users`);
      } else {
        console.error("❌ Auto record config JSON data is not an object as expected");
        autoRecordConfig = {};
      }
    } catch (parseError) {
      console.error("❌ Error parsing auto record config JSON:", parseError.message);
      // Backup the corrupted file
      const backupPath = `${config.AUTO_RECORD_CONFIG_PATH}.corrupt.${Date.now()}`;
      await fs.copy(config.AUTO_RECORD_CONFIG_PATH, backupPath);
      console.log(`📋 Backed up corrupted file to ${backupPath}`);
      
      autoRecordConfig = {};
    }

    // Always save to ensure consistent format
    await saveAutoRecordConfig();
    return autoRecordConfig;
  } catch (error) {
    console.error("❌ Error loading auto record config:", error.message, error.stack);
    autoRecordConfig = {};
    await saveAutoRecordConfig();
    return autoRecordConfig;
  }
}

async function saveAutoRecordConfig() {
  try {
    // Ensure directory exists
    const dir = path.dirname(config.AUTO_RECORD_CONFIG_PATH);
    await fs.ensureDir(dir);

    console.log(`💾 Saving auto record config for ${Object.keys(autoRecordConfig).length} users`);

    const tempFile = `${config.AUTO_RECORD_CONFIG_PATH}.tmp`;

    // Write to temp file
    await fs.writeFile(tempFile, JSON.stringify(autoRecordConfig, null, 2));

    // Check if the temp file actually exists before renaming
    if (!await fs.pathExists(tempFile)) {
      throw new Error(`Failed to write temp file: ${tempFile}`);
    }

    // Rename the file (atomic operation)
    await fs.rename(tempFile, config.AUTO_RECORD_CONFIG_PATH);

    console.log(`✅ Successfully saved auto record config`);
    return true;
  } catch (error) {
    console.error("❌ Error saving autoRecordConfig.json:", error.message, error.stack);
    return false;
  }
}

async function saveAutoRecordConfig() {
  try {
    // Ensure directory exists
    const dir = path.dirname(config.AUTO_RECORD_CONFIG_PATH);
    await fs.ensureDir(dir);

    const tempFile = `${config.AUTO_RECORD_CONFIG_PATH}.tmp`;

    console.log(`📝 Attempting to write temp config file: ${tempFile}`);

    // Write to temp file
    await fs.writeFile(tempFile, JSON.stringify(autoRecordConfig, null, 2));

    // Check if the temp file actually exists before renaming
    if (!fs.existsSync(tempFile)) {
      throw new Error(`🚨 Temp file missing! ${tempFile} was not created.`);
    }

    console.log(`📂 Renaming ${tempFile} → ${config.AUTO_RECORD_CONFIG_PATH}`);

    await fs.rename(tempFile, config.AUTO_RECORD_CONFIG_PATH);

    console.log(`💾 Successfully saved auto record config to ${config.AUTO_RECORD_CONFIG_PATH}`);
    return true;
  } catch (error) {
    console.error("❌ Error saving autoRecordConfig.json:", error);
    return false;
  }
}


/**
 * Get auto record config for a user
 */
function getUserAutoRecordConfig(userId) {
  const userIdStr = userId.toString();
  return autoRecordConfig[userIdStr] || null;
}

/**
 * Set auto record config for a user
 */
async function setUserAutoRecordConfig(userId, chatId, configData) {
  const userIdStr = userId.toString();
  const chatIdStr = chatId.toString();
  
  // Initialize if not exists
  if (!autoRecordConfig[userIdStr]) {
    autoRecordConfig[userIdStr] = {
      enabled: false,
      duration: 180, // Default 3 minutes
      chatId: chatIdStr,
      lastNotification: null,
      usernames: []
    };
  }
  
  // Update with provided data
  autoRecordConfig[userIdStr] = {
    ...autoRecordConfig[userIdStr],
    ...configData,
    chatId: chatIdStr // Always ensure chatId is set correctly
  };
  
  await saveAutoRecordConfig();
  return true;
}

/**
 * Enable auto recording for a user
 */
async function enableAutoRecording(userId, chatId) {
  const userIdStr = userId.toString();
  const chatIdStr = chatId.toString();
  
  // Initialize if not exists
  if (!autoRecordConfig[userIdStr]) {
    autoRecordConfig[userIdStr] = {
      enabled: true,
      duration: 180, // Default 3 minutes
      chatId: chatIdStr,
      lastNotification: null,
      usernames: []
    };
  } else {
    autoRecordConfig[userIdStr].enabled = true;
    autoRecordConfig[userIdStr].chatId = chatIdStr;
  }
  
  await saveAutoRecordConfig();
  return true;
}

/**
 * Disable auto recording for a user
 */
async function disableAutoRecording(userId) {
  const userIdStr = userId.toString();
  
  if (autoRecordConfig[userIdStr]) {
    autoRecordConfig[userIdStr].enabled = false;
    await saveAutoRecordConfig();
  }
  
  return true;
}

/**
 * Set auto recording duration for a user
 */
async function setAutoRecordingDuration(userId, duration) {
  const userIdStr = userId.toString();
  
  // Validate duration
  if (isNaN(duration) || duration < 60 || duration > 300) {
    return { success: false, message: "Duration must be between 60 and 300 seconds" };
  }
  
  if (!autoRecordConfig[userIdStr]) {
    return { success: false, message: "User config not found" };
  }
  
  autoRecordConfig[userIdStr].duration = duration;
  await saveAutoRecordConfig();
  
  return { success: true };
}

/**
 * Add a username to a user's auto-record list
 */
/**
 * Add a username to a user's auto-record list
 */
async function addUsernameToAutoRecord(userId, username) {
  const userIdStr = userId.toString();
  
  if (!autoRecordConfig[userIdStr]) {
    return { success: false, message: "User config not found" };
  }
  
  if (!autoRecordConfig[userIdStr].usernames) {
    autoRecordConfig[userIdStr].usernames = [];
  }
  
  // Check if username already exists
  if (autoRecordConfig[userIdStr].usernames.some(u => u.toLowerCase() === username.toLowerCase())) {
    return { success: false, message: `${username} is already in your auto-record list` };
  }
  
  // Check if maximum number of monitors reached
  if (autoRecordConfig[userIdStr].usernames.length >= config.MAX_AUTO_RECORD_MONITORS) {
    return { 
      success: false, 
      message: `You've reached the maximum of ${config.MAX_AUTO_RECORD_MONITORS} auto-record monitors. Remove some before adding more.` 
    };
  }
  
  autoRecordConfig[userIdStr].usernames.push(username);
  await saveAutoRecordConfig();
  
  return { success: true };
}

/**
 * Remove a username from a user's auto-record list
 */
async function removeUsernameFromAutoRecord(userId, username) {
  const userIdStr = userId.toString();
  
  if (!autoRecordConfig[userIdStr] || !autoRecordConfig[userIdStr].usernames) {
    return { success: false, message: "User config or usernames not found" };
  }
  
  const initialLength = autoRecordConfig[userIdStr].usernames.length;
  
  autoRecordConfig[userIdStr].usernames = autoRecordConfig[userIdStr].usernames.filter(
    u => u.toLowerCase() !== username.toLowerCase()
  );
  
  if (autoRecordConfig[userIdStr].usernames.length < initialLength) {
    await saveAutoRecordConfig();
    return { success: true };
  }
  
  return { success: false, message: `${username} is not in your auto-record list` };
}

/**
 * Clear all usernames from a user's auto-record list
 */
async function clearAutoRecordUsernames(userId) {
  const userIdStr = userId.toString();
  
  if (!autoRecordConfig[userIdStr]) {
    return { success: false, message: "User config not found" };
  }
  
  autoRecordConfig[userIdStr].usernames = [];
  await saveAutoRecordConfig();
  
  return { success: true };
}

/**
 * Get users who have auto-recording enabled for a specific username
 */
function getUsersWithAutoRecordForUsername(username, chatId) {
  const eligibleUsers = [];
  
  for (const [userId, config] of Object.entries(autoRecordConfig)) {
    if (config.enabled && 
        config.chatId === chatId.toString()) {
      
      // If specific usernames are set, check if this streamer is included
      if (config.usernames.length > 0) {
        if (config.usernames.some(u => u.toLowerCase() === username.toLowerCase())) {
          eligibleUsers.push({
            userId: parseInt(userId, 10),
            duration: config.duration
          });
        }
      } else {
        // No specific usernames, so include all
        eligibleUsers.push({
          userId: parseInt(userId, 10),
          duration: config.duration
        });
      }
    }
  }
  
  return eligibleUsers;
}

module.exports = {
  loadAutoRecordConfig,
  saveAutoRecordConfig,
  getUserAutoRecordConfig,
  setUserAutoRecordConfig,
  enableAutoRecording,
  disableAutoRecording,
  setAutoRecordingDuration,
  addUsernameToAutoRecord,
  removeUsernameFromAutoRecord,
  clearAutoRecordUsernames,
  getUsersWithAutoRecordForUsername
};