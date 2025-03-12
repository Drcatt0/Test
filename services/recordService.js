/**
 * Recording Service
 */
const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid'); // Add uuid dependency or use Date.now() if not available
const browserService = require('./browserService');
const monitoredUsersModel = require('../models/monitoredUsers');
const premiumUsersModel = require('../models/premiumUsers');
const memoryService = require('./memoryService');
const uploadService = require('./uploadService');
const config = require('../config/config');

// In-memory rate limit storage
const userRateLimits = {};

// Active recording processes
const activeRecordingProcesses = new Map();

/**
 * Check if a user can record based on rate limits (free users only)
 */
function canUserRecord(userId) {
  // Premium users can always record
  if (premiumUsersModel.isPremiumUser(userId)) {
    return { allowed: true };
  }
  
  const now = Date.now();
  const userIdStr = userId.toString();
  
  // If no previous recording or limit has expired
  if (!userRateLimits[userIdStr] || (now - userRateLimits[userIdStr].lastRecording > config.FREE_USER_COOLDOWN)) {
    return { allowed: true };
  }
  
  // Calculate time remaining until they can record again
  const timeElapsed = now - userRateLimits[userIdStr].lastRecording;
  const timeRemaining = Math.ceil((config.FREE_USER_COOLDOWN - timeElapsed) / 1000);
  const minutes = Math.floor(timeRemaining / 60);
  const seconds = timeRemaining % 60;
  
  return { 
    allowed: false, 
    timeRemaining: timeRemaining,
    formattedTime: `${minutes}m ${seconds}s`
  };
}

/**
 * Update user's recording timestamp for rate limiting
 */
function updateUserRecordingTime(userId) {
  const userIdStr = userId.toString();
  userRateLimits[userIdStr] = {
    lastRecording: Date.now()
  };
}

/**
 * Determine model ID for a username
 */
async function determineModelId(username) {
  let modelId = null;
  
  try {
    const browser = await browserService.getBrowser();
    const page = await browser.newPage();
    
    try {
      await page.goto(`https://stripchat.com/${username}`, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      // Extract model ID from the page
      modelId = await page.evaluate(() => {
        try {
          // Try different ways to get the model ID
          // Method 1: Check meta tags
          const metaTag = document.querySelector('meta[name="modelId"]') || 
                          document.querySelector('meta[property="modelId"]');
          if (metaTag) return metaTag.getAttribute('content');
          
          // Method 2: Look for it in page source
          const pageContent = document.documentElement.outerHTML;
          const modelIdMatch = pageContent.match(/modelId"?:\s*"?(\d+)"?/);
          if (modelIdMatch && modelIdMatch[1]) return modelIdMatch[1];
          
          // Method 3: Extract from any URLs
          const modelUrls = [...document.querySelectorAll('a[href*="models/"]')].map(a => a.href);
          for (const url of modelUrls) {
            const match = url.match(/models\/(\d+)/);
            if (match && match[1]) return match[1];
          }
          
          return null;
        } catch (e) {
          console.error("Error extracting model ID:", e);
          return null;
        }
      });
      
      await page.close();
      browserService.releaseBrowser(browser);
    } catch (error) {
      await page.close();
      browserService.releaseBrowser(browser);
      throw error;
    }
  } catch (error) {
    console.error("Error determining model ID:", error);
    browserService.releaseBrowser();
  }

  return modelId;
}

/**
 * Generate possible stream URLs for a username
 */
function generateStreamUrls(username, modelId) {
  // Try multiple stream URL patterns
  const possibleStreamUrls = [];
  
  if (modelId) {
    // If we have the model ID, try different quality levels and server patterns
    // Start with higher quality options for better recording
    const qualities = ['1080p60', '720p60', '720p', '480p30', '360p30', '240p30', '160p'];
    const serverPatterns = ['b-hls-', 'hls-', 'media-hls'];
    const serverNumbers = ['08', '16', '24', '32']; // Different server numbers
    
    for (const server of serverPatterns) {
      for (const number of serverNumbers) {
        for (const quality of qualities) {
          possibleStreamUrls.push(
            `https://media-hls.doppiocdn.com/${server}${number}/${modelId}/${modelId}_${quality}.m3u8?playlistType=lowLatency`,
            `https://edge-hls.doppiocdn.com/hls/${modelId}/master/${modelId}_${quality}.m3u8?playlistType=lowLatency`
          );
        }
      }
    }
    
    // Add auto quality options
    possibleStreamUrls.push(
      `https://edge-hls.doppiocdn.com/hls/${modelId}/master/${modelId}_auto.m3u8?playlistType=lowLatency`
    );
  }
  
  // Add some fallback stream URLs that don't require model ID
  possibleStreamUrls.push(
    `https://edge-hls.doppiocdn.com/hls/master/${username}_auto.m3u8`,
    `https://media-hls.doppiocdn.com/hls/${username}/master/${username}_auto.m3u8`
  );
  
  // Add recent working URLs if available
  const recentUrls = monitoredUsersModel.getRecentUrls(username);
  if (recentUrls.length > 0) {
    possibleStreamUrls.unshift(...recentUrls);
  }
  
  return [...new Set(possibleStreamUrls)]; // Remove duplicates
}

/**
 * Test if a stream URL works
 */
async function testStreamUrl(streamUrl) {
  try {
    const recordingId = Date.now().toString();
    const result = await new Promise((resolve) => {
      const testProcess = spawn('ffmpeg', [
        '-i', streamUrl,
        '-t', '2',
        '-c', 'copy',
        '-y',
        `/tmp/test_segment_${recordingId}.mp4`
      ]);
      
      let testOutput = '';
      testProcess.stderr.on('data', (data) => {
        testOutput += data.toString();
      });
      
      testProcess.on('close', (code) => {
        // Clean up test file
        try {
          fs.unlinkSync(`/tmp/test_segment_${recordingId}.mp4`);
        } catch (e) {}
        
        resolve({ code, output: testOutput });
      });
      
      // Set a timeout to kill the process if it hangs
      setTimeout(() => {
        testProcess.kill('SIGTERM');
        resolve({ code: 1, output: 'Timeout' });
      }, 10000);
    });
    
    return result.code === 0;
  } catch (error) {
    console.error(`Error testing stream URL ${streamUrl}:`, error);
    return false;
  }
}

/**
 * Record a stream with unique recording ID for concurrent recordings
 */
async function recordStream(streamUrl, duration, outputFile, recordingId) {
  return new Promise((resolve, reject) => {
    // Use the configured ffmpeg arguments and add specific ones for this recording
    const ffmpegArgs = [
      '-i', streamUrl,
      '-t', duration.toString(),
      ...config.FFMPEG_RECORDING_ARGS,
      outputFile
    ];
    
    console.log(`Starting ffmpeg with args: ${ffmpegArgs.join(' ')}`);
    
    const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);
    
    // Store the process for potential cancellation
    activeRecordingProcesses.set(recordingId, ffmpegProcess);
    
    let offlineDetected = false;
    let ffmpegOutput = '';
    
    ffmpegProcess.stderr.on('data', (data) => {
      const chunk = data.toString();
      ffmpegOutput += chunk;
      
      // Check for signs that stream went offline
      if (chunk.includes('Connection refused') || 
          chunk.includes('404 Not Found') || 
          chunk.includes('Server returned 403 Forbidden') ||
          chunk.includes('End of file') ||
          chunk.includes('Invalid data found')) {
        offlineDetected = true;
      }
    });
    
    ffmpegProcess.on('close', (code) => {
      // Clean up
      activeRecordingProcesses.delete(recordingId);
      
      resolve({
        code,
        output: ffmpegOutput,
        offlineDetected
      });
    });
    
    ffmpegProcess.on('error', (err) => {
      console.error('FFmpeg process error:', err);
      activeRecordingProcesses.delete(recordingId);
      resolve({
        code: 1,
        output: `FFmpeg error: ${err.message}`,
        offlineDetected: true
      });
    });
    
    // Set a timeout that's substantially longer than the recording should take
    // For short recordings, give at least 5 minutes; for longer ones, use 3x the duration
    const timeoutDuration = Math.max(300000, (duration * 1000) * 3); // At least 5 minutes or 3x the duration
    const timeout = setTimeout(() => {
      console.log(`Recording timeout triggered after ${timeoutDuration/1000} seconds for recording ${recordingId}`);
      
      // Don't reject, just try to terminate gracefully
      try {
        if (activeRecordingProcesses.has(recordingId)) {
          const proc = activeRecordingProcesses.get(recordingId);
          proc.kill('SIGTERM');
          
          // Give process time to shut down gracefully
          setTimeout(() => {
            // Force kill if still running
            try { 
              if (activeRecordingProcesses.has(recordingId)) {
                const proc = activeRecordingProcesses.get(recordingId);
                proc.kill('SIGKILL');
                activeRecordingProcesses.delete(recordingId);
              }
            } catch (e) {
              console.error('Error killing ffmpeg process:', e);
            }
            
            // Resolve with what we have so far
            resolve({
              code: 1,
              output: ffmpegOutput + '\nProcess terminated due to timeout',
              offlineDetected: true
            });
          }, 5000);  // Give 5 seconds for graceful shutdown
        }
      } catch (e) {
        console.error('Error terminating ffmpeg process:', e);
        activeRecordingProcesses.delete(recordingId);
        resolve({
          code: 1,
          output: ffmpegOutput + '\nProcess timeout - failed to terminate',
          offlineDetected: true
        });
      }
    }, timeoutDuration);
    
    // Clear the timeout if process ends before timeout
    ffmpegProcess.on('close', () => {
      clearTimeout(timeout);
    });
  });
}

async function handleRecordedFile(ctx, outputFile, username, duration, timestamp) {
  try {
    // First check if the file exists
    const fileExists = await fs.pathExists(outputFile);
    if (!fileExists) {
      await ctx.reply("❌ Recording failed - output file was not created.");
      return false;
    }
    
    // Check if the file is a reasonable size
    const fileStats = await fs.stat(outputFile);
    
    if (fileStats.size < 10000) {
      await ctx.reply("⚠️ Recording produced an empty or corrupt file. This could mean the stream went offline or changed format.");
      return false;
    }
    
    // Format caption
    const caption = `${username} - ${duration} seconds - Recorded on ${new Date().toLocaleString()}`;
    
    try {
      console.log(`📤 Sending video file (${(fileStats.size/1024/1024).toFixed(2)}MB) to Telegram...`);
      
      // With local Telegram API server, we can send files up to 2GB
      await ctx.replyWithVideo({ 
        source: outputFile,
        filename: `${username}_${timestamp}.mp4`,
        caption: caption
      }, { 
        // Longer timeout for large files
        timeout: Math.max(60000, fileStats.size / 10000) // 1 minute minimum, or longer for large files
      });
      
      console.log(`✅ Successfully sent video file to Telegram`);
      return true;
    } catch (sendError) {
      console.error("Error sending video:", sendError);
      await ctx.reply("❌ Failed to send video. Error: " + sendError.message);
      return false;
    }
  } catch (error) {
    console.error("Error handling recording:", error);
    await ctx.reply("❌ Error processing recording.");
    return false;
  }
}

/**
 * Execute a recording command
 */
async function executeRecord(ctx, username, duration) {
  const chatId = ctx.message.chat.id;
  const userId = ctx.message.from.id;
  const recordingId = `rec_${chatId}_${userId}_${Date.now()}`;
  
  // Lazy import to avoid circular dependency
  const monitorService = require('./monitorService');
  
  // Apply rate limiting for free users
  const rateLimit = canUserRecord(userId);
  if (!rateLimit.allowed) {
    await ctx.reply(
      `⏱️ *Rate limit exceeded*\n\nFree users can record once every 3 minutes.\nPlease wait ${rateLimit.formattedTime} before recording again.\n\nUpgrade to premium to remove this limit with /premium`,
      { parse_mode: 'Markdown' }
    );
    return false;
  }
  
  // Apply recording duration limits
  const isPremium = premiumUsersModel.isPremiumUser(userId);
  let adjustedDuration = duration;
  
  if (!isPremium) {
    // Free users are limited
    if (adjustedDuration > config.FREE_USER_MAX_DURATION) {
      await ctx.reply(`⚠️ Free users are limited to ${config.FREE_USER_MAX_DURATION} seconds of recording. Upgrade to premium for unlimited recording duration! Use /premium to learn more.`);
      adjustedDuration = config.FREE_USER_MAX_DURATION;
    }
    
    // Update the rate limit for free users
    updateUserRecordingTime(userId);
  } else if (adjustedDuration > config.PREMIUM_USER_MAX_DURATION) {
    // Even premium users have a reasonable limit
    await ctx.reply(`⚠️ Recording duration capped at ${config.PREMIUM_USER_MAX_DURATION / 60} minutes (${config.PREMIUM_USER_MAX_DURATION} seconds) to ensure quality. For longer recordings, you can always record again.`);
    adjustedDuration = config.PREMIUM_USER_MAX_DURATION;
  }
  
  // Don't check for active recording - allow concurrent recordings
  
  // Check if the streamer is live
  await ctx.reply(`🔍 Checking if ${username} is live...${isPremium ? ' [✨ Premium]' : ''}`);
  const status = await monitorService.checkStripchatStatus(username);
  
  if (!status.isLive) {
    await ctx.reply(`❌ ${username} is not live right now. Cannot record.`);
    return false;
  }
  
  const liveMsg = await ctx.reply(`✅ ${username} is live! Starting recording process...`);
  
  // Try to get the model ID
  const modelId = await determineModelId(username);
  
  if (!modelId) {
    await ctx.telegram.editMessageText(
      chatId, 
      liveMsg.message_id, 
      undefined, 
      `✅ ${username} is live! Starting recording process...\n🔍 Model ID not found. Trying alternate methods...`
    );
  }
  
  // Generate possible stream URLs
  const possibleStreamUrls = generateStreamUrls(username, modelId);
  
  // Create a status message that we'll keep updating
  const statusMsg = await ctx.reply(`🔄 Testing stream URLs (0/${possibleStreamUrls.length})...`);
  
  // Try each URL until we find one that works
  let recordingSuccess = false;
  let urlsTried = 0;
  const totalUrls = possibleStreamUrls.length;
  
  for (const streamUrl of possibleStreamUrls) {
    if (recordingSuccess) break;
    
    urlsTried++;
    
    // Update status message every time instead of sending new messages
    await ctx.telegram.editMessageText(
      chatId, 
      statusMsg.message_id, 
      undefined, 
      `🔄 Testing stream URLs (${urlsTried}/${totalUrls})...`
    );
    
    const timestamp = Date.now();
    const baseFileName = `${username}_${userId}_${timestamp}`;
    const outputFile = `/tmp/${baseFileName}.mp4`;
    
    // Test if the URL works first
    const urlWorks = await testStreamUrl(streamUrl);
    if (!urlWorks) {
      console.log(`URL ${streamUrl} failed test`);
      continue;
    }
    
    // If the URL works, start recording
    await ctx.telegram.editMessageText(
      chatId, 
      statusMsg.message_id, 
      undefined, 
      `🎬 Found working stream! Recording ${adjustedDuration} seconds...`
    );
    
    const result = await recordStream(streamUrl, adjustedDuration, outputFile, recordingId);
    
    if (result.offlineDetected) {
      await ctx.reply("📹 Stream went offline, but we saved what we could!");
    } else if (result.code === 0) {
      await ctx.reply("✅ Recording complete!");
    } else {
      await ctx.reply("⚠️ Recording may have encountered issues. Checking the result...");
    }
    
    // Handle the file
    const success = await handleRecordedFile(ctx, outputFile, username, adjustedDuration, timestamp);
    
    if (success) {
      // Store the working URL for future use
      await monitoredUsersModel.storeWorkingUrl(username, streamUrl);
      recordingSuccess = true;
    }
    
    // Clean up the file
    try { await fs.unlink(outputFile); } catch (e) {}
    
    // Check memory usage
    await memoryService.checkMemoryUsage();
  }
  
  if (!recordingSuccess) {
    await ctx.reply("❌ Could not find a working stream URL. Please try again later.");
  }
  
  // Clean up the status message after we're done with it
  try {
    await ctx.telegram.deleteMessage(chatId, statusMsg.message_id);
  } catch (e) {
    console.error("Could not delete status message:", e);
  }
  
  return recordingSuccess;
}

/**
 * Cancel an active recording
 */
function cancelRecording(recordingId) {
  if (activeRecordingProcesses.has(recordingId)) {
    try {
      const process = activeRecordingProcesses.get(recordingId);
      process.kill('SIGTERM');
      activeRecordingProcesses.delete(recordingId);
      return true;
    } catch (error) {
      console.error(`Error cancelling recording ${recordingId}:`, error);
      return false;
    }
  }
  return false;
}

module.exports = {
  canUserRecord,
  updateUserRecordingTime,
  executeRecord,
  cancelRecording
};