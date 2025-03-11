/**
 * Auto Record Configuration Data Model
 */
const fs = require('fs-extra');
const config = require('../config/config');

// In-memory storage
let autoRecordConfig = {};

/**
 * Load auto record config from JSON file
 */
async function loadAutoRecordConfig() {
  try {
    const data = await fs.readFile(config.AUTO_RECORD_CONFIG_PATH, 'utf-8');
    autoRecordConfig = JSON.parse(data);
    console.log(`Loaded auto record config for ${Object.keys(autoRecordConfig).length} users`);
  } catch (error) {
    console.log("No existing autoRecordConfig.json found. Starting fresh.");
    autoRecordConfig = {};
    await saveAutoRecordConfig();
  }
  return autoRecordConfig;
}

/**
 * Save auto record config to JSON file
 */
async function saveAutoRecordConfig() {
  try {
    await fs.writeFile(config.AUTO_RECORD_CONFIG_PATH, JSON.stringify(autoRecordConfig, null, 2));
    return true;
  } catch (error) {
    console.error("Error saving autoRecordConfig.json:", error);
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
