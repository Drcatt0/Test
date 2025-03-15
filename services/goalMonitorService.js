// Add this patch to the top of goalMonitorService.js
const lightweightChecker = require('./lightweightChecker');

// Replace getStreamStatus with this optimized version:
/**
 * Get the status of a streamer - OPTIMIZED VERSION
 * Uses lightweight HTTP checks when possible
 */
async function getStreamStatus(username) {
  try {
    // Use lightweight cached check with forced refresh for goal monitoring
    // since we need the most up-to-date data for goals
    return await lightweightChecker.getCachedStatus(username, {
      includeGoal: true,
      forceRefresh: true, // Always get fresh data for goal monitoring
      maxAge: 5000 // Very short cache time (5 seconds) for goal monitoring
    });
  } catch (error) {
    console.error(`Error getting status for ${username}:`, error);
    return { 
      isLive: false, 
      goal: { active: false, progress: 0, text: '', completed: false, tokenAmount: 0 },
      nextBroadcast: null
    };
  }
}