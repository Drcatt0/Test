/**
 * Helper Utility Functions
 */
const fs = require('fs-extra');
const path = require('path');

/**
 * Format duration in seconds to a human-readable string
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration string
 */
function formatDuration(seconds) {
  if (seconds < 60) {
    return `${seconds} seconds`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (remainingSeconds === 0) {
      return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    }
    return `${minutes} minute${minutes !== 1 ? 's' : ''} ${remainingSeconds} second${remainingSeconds !== 1 ? 's' : ''}`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const remainingMinutes = Math.floor((seconds % 3600) / 60);
    return `${hours} hour${hours !== 1 ? 's' : ''} ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}`;
  }
}

/**
 * Format time remaining in seconds to a short format (e.g., "2m 45s")
 * @param {number} seconds - Time remaining in seconds
 * @returns {string} Formatted time string
 */
function formatTimeRemaining(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Generate a unique filename with timestamp
 * @param {string} username - Username
 * @param {string} extension - File extension (default: mp4)
 * @returns {string} Unique filename
 */
function generateUniqueFilename(username, extension = 'mp4') {
  const timestamp = Date.now();
  return `${username}_${timestamp}.${extension}`;
}

/**
 * Generate a temporary file path
 * @param {string} filename - Filename
 * @returns {string} Full path to temporary file
 */
function getTempFilePath(filename) {
  return path.join('/tmp', filename);
}

/**
 * Clean up a file if it exists
 * @param {string} filePath - Path to file
 * @returns {Promise<boolean>} True if file was deleted or doesn't exist
 */
async function cleanupFile(filePath) {
  try {
    if (await fs.pathExists(filePath)) {
      await fs.unlink(filePath);
      return true;
    }
    return true;
  } catch (error) {
    console.error(`Error cleaning up file ${filePath}:`, error);
    return false;
  }
}

/**
 * Create a directory if it doesn't exist
 * @param {string} dirPath - Path to directory
 * @returns {Promise<boolean>} True if directory exists or was created
 */
async function ensureDirectory(dirPath) {
  try {
    await fs.ensureDir(dirPath);
    return true;
  } catch (error) {
    console.error(`Error ensuring directory ${dirPath}:`, error);
    return false;
  }
}

module.exports = {
  formatDuration,
  formatTimeRemaining,
  generateUniqueFilename,
  getTempFilePath,
  cleanupFile,
  ensureDirectory
};