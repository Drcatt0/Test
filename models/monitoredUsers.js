/**
 * Monitored Users Data Model
 */
const fs = require('fs-extra');
const config = require('../config/config');

// In-memory storage
let monitoredUsers = [];

/**
 * Load monitored users from JSON file
 */
async function loadMonitoredUsers() {
  try {
    const data = await fs.readFile(config.JSON_FILE_PATH, 'utf-8');
    monitoredUsers = JSON.parse(data);
    console.log(`Loaded ${monitoredUsers.length} monitored users`);
  } catch (error) {
    console.log("No existing monitoredUsers.json found. Starting fresh.");
    monitoredUsers = [];
    await saveMonitoredUsers();
  }
  return monitoredUsers;
}

/**
 * Save monitored users to JSON file
 */
async function saveMonitoredUsers() {
  try {
    await fs.writeFile(config.JSON_FILE_PATH, JSON.stringify(monitoredUsers, null, 2));
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
