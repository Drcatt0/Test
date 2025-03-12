/**
 * Monitored Users Data Model
 */
const fs = require('fs-extra');
const path = require('path'); // Added this import for path manipulation
const config = require('../config/config');

// In-memory storage
let monitoredUsers = [];

/**
 * Load monitored users from JSON file
 */
async function loadMonitoredUsers() {
  try {
    // Check if the file exists first
    if (!await fs.pathExists(config.JSON_FILE_PATH)) {
      console.log(`⚠️ File not found: ${config.JSON_FILE_PATH}. Creating a new one.`);
      monitoredUsers = [];
      await saveMonitoredUsers();
      return monitoredUsers;
    }

    // Read the file
    const rawData = await fs.readFile(config.JSON_FILE_PATH, 'utf-8');
    console.log(`📄 Read ${rawData.length} bytes from ${config.JSON_FILE_PATH}`);
    
    if (!rawData || rawData.trim() === '') {
      console.log("⚠️ Monitored users file is empty. Starting fresh.");
      monitoredUsers = [];
      await saveMonitoredUsers();
      return monitoredUsers;
    }
    
    try {
      const parsedData = JSON.parse(rawData);
      console.log(`🔍 Successfully parsed JSON data`);
      
      if (Array.isArray(parsedData)) {
        monitoredUsers = parsedData;
        console.log(`✅ Loaded ${monitoredUsers.length} monitored users`);
      } else {
        console.error("❌ JSON data is not an array as expected");
        monitoredUsers = [];
      }
    } catch (parseError) {
      console.error("❌ Error parsing JSON:", parseError.message);
      // Backup the corrupted file
      const backupPath = `${config.JSON_FILE_PATH}.corrupt.${Date.now()}`;
      await fs.copy(config.JSON_FILE_PATH, backupPath);
      console.log(`📋 Backed up corrupted file to ${backupPath}`);
      
      monitoredUsers = [];
    }

    await saveMonitoredUsers();
    return monitoredUsers;
  } catch (error) {
    console.error("❌ Error loading monitored users:", error.message);
    monitoredUsers = [];
    await saveMonitoredUsers();
    return monitoredUsers;
  }
}

/**
 * Save monitored users to JSON file
 */
async function saveMonitoredUsers() {
  try {
    // Ensure the data directory exists
    const dir = path.dirname(config.JSON_FILE_PATH);
    await fs.ensureDir(dir);
    
    // Log the data being saved
    console.log(`💾 Saving ${monitoredUsers.length} monitored users to ${config.JSON_FILE_PATH}`);
    
    // Write to a temp file first, then rename for atomic operation
    const tempFile = `${config.JSON_FILE_PATH}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(monitoredUsers, null, 2));
    
    // Verify the file was written
    if (!await fs.pathExists(tempFile)) {
      throw new Error(`Failed to write temp file: ${tempFile}`);
    }
    
    // Rename the file (atomic operation)
    await fs.rename(tempFile, config.JSON_FILE_PATH);
    
    console.log(`✅ Successfully saved monitored users to disk`);
    return true;
  } catch (error) {
    console.error("❌ Error saving monitoredUsers.json:", error.message, error.stack);
    return false;
  }
}

/**
 * Save monitored users to JSON file
 */
async function saveMonitoredUsers() {
  try {
    // Ensure the data directory exists
    const dir = path.dirname(config.JSON_FILE_PATH);
    await fs.ensureDir(dir);
    
    // Write to a temp file first, then rename for atomic operation
    const tempFile = `${config.JSON_FILE_PATH}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(monitoredUsers, null, 2));
    await fs.rename(tempFile, config.JSON_FILE_PATH);
    
    console.log(`Saved ${monitoredUsers.length} monitored users to disk`);
    return true;
  } catch (error) {
    console.error("Error saving monitoredUsers.json:", error);
    return false;
  }
}

/**
 * Add a user to the monitored list
 */
async function addMonitoredUser(username, chatId) {
  // Check if already monitored
  const existingIndex = monitoredUsers.findIndex(
    item => item.username.toLowerCase() === username.toLowerCase() && item.chatId === chatId
  );
  
  if (existingIndex !== -1) {
    return { success: false, message: `You're already monitoring ${username}` };
  }
  
  // Add the user
  monitoredUsers.push({
    username,
    chatId,
    isLive: false,
    lastChecked: new Date().toISOString(),
    recentUrls: [] // Field to store recently working URLs
  });
  
  await saveMonitoredUsers();
  return { success: true };
}

/**
 * Remove a user from the monitored list
 */
async function removeMonitoredUser(username, chatId) {
  const initialLength = monitoredUsers.length;
  
  monitoredUsers = monitoredUsers.filter(
    item => !(item.username.toLowerCase() === username.toLowerCase() && item.chatId === chatId)
  );
  
  if (monitoredUsers.length < initialLength) {
    await saveMonitoredUsers();
    return { success: true };
  }
  
  return { success: false, message: `${username} is not in your monitoring list` };
}

/**
 * Get all monitored users for a specific chat
 */
function getMonitoredUsersForChat(chatId) {
  return monitoredUsers.filter(user => user.chatId === chatId);
}

/**
 * Update a monitored user's status
 */
async function updateUserStatus(username, chatId, status) {
  const userIndex = monitoredUsers.findIndex(
    item => item.username.toLowerCase() === username.toLowerCase() && item.chatId === chatId
  );
  
  if (userIndex === -1) {
    return false;
  }
  
  // Update the user data
  monitoredUsers[userIndex] = {
    ...monitoredUsers[userIndex],
    ...status,
    lastChecked: new Date().toISOString()
  };
  
  await saveMonitoredUsers();
  return true;
}

/**
 * Store a working stream URL for future use
 */
async function storeWorkingUrl(username, url) {
  const userIndices = monitoredUsers
    .map((user, index) => user.username.toLowerCase() === username.toLowerCase() ? index : -1)
    .filter(index => index !== -1);
  
  let updated = false;
  
  for (const index of userIndices) {
    monitoredUsers[index].recentUrls = monitoredUsers[index].recentUrls || [];
    
    // Add to the beginning if not already there
    if (!monitoredUsers[index].recentUrls.includes(url)) {
      monitoredUsers[index].recentUrls.unshift(url);
      monitoredUsers[index].recentUrls = monitoredUsers[index].recentUrls.slice(0, 5); // Keep only 5 most recent
      updated = true;
    }
  }
  
  if (updated) {
    await saveMonitoredUsers();
  }
  
  return updated;
}

/**
 * Get all monitored users
 */
function getAllMonitoredUsers() {
  return monitoredUsers;
}

/**
 * Get recent working URLs for a username
 */
function getRecentUrls(username) {
  const urls = [];
  
  for (const user of monitoredUsers) {
    if (user.username.toLowerCase() === username.toLowerCase() && user.recentUrls) {
      urls.push(...user.recentUrls);
    }
  }
  
  return [...new Set(urls)]; // Remove duplicates
}

module.exports = {
  loadMonitoredUsers,
  saveMonitoredUsers,
  addMonitoredUser,
  removeMonitoredUser,
  getMonitoredUsersForChat,
  updateUserStatus,
  storeWorkingUrl,
  getAllMonitoredUsers,
  getRecentUrls
};