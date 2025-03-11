/**
 * Memory Management Service
 */
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const config = require('../config/config');
const browserService = require('./browserService');

// Intervals for cleanup routines
let memoryCheckInterval = null;
let fileCleanupInterval = null;
let recordingCleanupInterval = null;

// Active recordings trackers
const activeRecordings = new Map();
const activeAutoRecordings = new Set();

/**
 * Add an active recording
 */
function addActiveRecording(chatId, username, userId, duration, isPremium) {
  const recordingKey = `${chatId}_${username.toLowerCase()}`;
  
  activeRecordings.set(recordingKey, {
    startTime: Date.now(),
    duration: duration,
    chatId: chatId,
    userId: userId,
    isPremium: isPremium
  });
  
  return recordingKey;
}

/**
 * Add an active auto recording
 */
function addActiveAutoRecording(chatId, username) {
  const recordingKey = `auto_${chatId}_${username.toLowerCase()}`;
  activeAutoRecordings.add(recordingKey);
  return recordingKey;
}

/**
 * Remove an active recording
 */
function removeActiveRecording(recordingKey) {
  return activeRecordings.delete(recordingKey);
}

/**
 * Remove an active auto recording
 */
function removeActiveAutoRecording(recordingKey) {
  return activeAutoRecordings.delete(recordingKey);
}

/**
 * Check if a user is currently being recorded
 */
function isRecordingActive(chatId, username) {
  const recordingKey = `${chatId}_${username.toLowerCase()}`;
  return activeRecordings.has(recordingKey);
}

/**
 * Check if a user is currently being auto-recorded
 */
function isAutoRecordingActive(chatId, username) {
  const recordingKey = `auto_${chatId}_${username.toLowerCase()}`;
  return activeAutoRecordings.has(recordingKey);
}

/**
 * Check and manage memory usage
 */
async function checkMemoryUsage() {
  const memInfo = process.memoryUsage();
  const memoryUsageMB = Math.round(memInfo.rss / 1024 / 1024);
  
  console.log(`Memory usage: ${memoryUsageMB}MB (RSS), Heap: ${Math.round(memInfo.heapUsed / 1024 / 1024)}MB / ${Math.round(memInfo.heapTotal / 1024 / 1024)}MB`);
  
  // Force garbage collection if memory usage is too high
  if (memoryUsageMB > config.MAX_MEMORY_USAGE_MB) {
    console.log("High memory usage detected, cleaning up resources...");
    
    // Close browser to free memory
    await browserService.closeBrowser();
    
    // Clear temporary files older than 1 hour
    try {
      await cleanupTemporaryFiles(60 * 60 * 1000); // 1 hour in milliseconds
    } catch (error) {
      console.error("Error cleaning up temp files during memory check:", error);
    }
    
    if (global.gc) {
      global.gc();
      console.log("Forced garbage collection");
    }
  }
  
  return memoryUsageMB;
}

/**
 * Clean up temporary files older than a specified age
 */
async function cleanupTemporaryFiles(maxAgeMs) {
  try {
    const tempDir = os.tmpdir();
    const files = await fs.readdir(tempDir);
    const now = Date.now();
    let filesRemoved = 0;
    
    for (const file of files) {
      if (file.includes('_') && (file.endsWith('.mp4') || file.endsWith('.zip') || file.endsWith('.html'))) {
        const filePath = path.join(tempDir, file);
        const stats = await fs.stat(filePath);
        
        // Remove files older than specified age
        if (now - stats.mtime.getTime() > maxAgeMs) {
          await fs.unlink(filePath);
          filesRemoved++;
        }
      }
    }
    
    if (filesRemoved > 0) {
      console.log(`Removed ${filesRemoved} old temporary files`);
    }
    
    return filesRemoved;
  } catch (error) {
    console.error("Error cleaning up temporary files:", error);
    throw error;
  }
}

/**
 * Clean up stale recordings
 */
function cleanupStaleRecordings() {
  const now = Date.now();
  let cleaned = 0;
  
  // Clean up active recordings
  for (const [key, recording] of activeRecordings.entries()) {
    const maxDuration = (recording.duration * 1000) + (5 * 60 * 1000); // 5 minutes extra
    if (now - recording.startTime > maxDuration) {
      console.log(`Cleaning up stale recording: ${key}`);
      activeRecordings.delete(key);
      cleaned++;
    }
  }
  
  // Clean up auto recordings
  for (const key of activeAutoRecordings) {
    // Auto recordings more than 15 minutes old are likely stale
    if (key.startsWith('auto_')) {
      const keyParts = key.split('_');
      const username = keyParts[keyParts.length - 1];
      console.log(`Cleaning up stale auto recording: ${username}`);
      activeAutoRecordings.delete(key);
      cleaned++;
    }
  }
  
  return cleaned;
}

/**
 * Start all cleanup routines
 */
function startCleanupRoutines() {
  // Check memory every 5 minutes
  memoryCheckInterval = setInterval(checkMemoryUsage, config.MEMORY_CHECK_INTERVAL);
  
  // Clean up temporary files every 30 minutes
  fileCleanupInterval = setInterval(() => {
    cleanupTemporaryFiles(60 * 60 * 1000); // 1 hour
  }, config.FILE_CLEANUP_INTERVAL);
  
  // Clean up stale recordings every minute
  recordingCleanupInterval = setInterval(cleanupStaleRecordings, config.RECORDING_CLEANUP_INTERVAL);
  
  console.log('Started memory management and cleanup routines');
}

/**
 * Stop all cleanup routines
 */
function stopCleanupRoutines() {
  if (memoryCheckInterval) clearInterval(memoryCheckInterval);
  if (fileCleanupInterval) clearInterval(fileCleanupInterval);
  if (recordingCleanupInterval) clearInterval(recordingCleanupInterval);
  
  console.log('Stopped memory management and cleanup routines');
}

module.exports = {
  checkMemoryUsage,
  cleanupTemporaryFiles,
  cleanupStaleRecordings,
  startCleanupRoutines,
  stopCleanupRoutines,
  addActiveRecording,
  addActiveAutoRecording,
  removeActiveRecording,
  removeActiveAutoRecording,
  isRecordingActive,
  isAutoRecordingActive,
  activeRecordings,
  activeAutoRecordings
};
