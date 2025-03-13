/**
 * Emergency fix for monitoring services
 * This script directly calls the monitoring functions and resets intervals
 */
const goalMonitorService = require('./services/goalMonitorService');
const notifierService = require('./services/notifierService');
const monitoredUsersModel = require('./models/monitoredUsers');
const memoryService = require('./services/memoryService');

// Get the bot instance from global scope
const bot = global.botInstance;

function fixMonitoring() {
  console.log("🔧 APPLYING EMERGENCY MONITORING FIX");
  
  // 1. Force clear any existing intervals
  if (goalMonitorService.monitorInterval) {
    clearInterval(goalMonitorService.monitorInterval);
    goalMonitorService.monitorInterval = null;
    console.log("✓ Cleared existing goal monitor interval");
  }
  
  // 2. Force a direct check of all goals
  console.log("✓ Forcing immediate goal monitoring check");
  goalMonitorService.monitorAllGoals(bot).catch(err => {
    console.error("Error in forced goal check:", err);
  });
  
  // 3. Set up a new, more frequent interval (every 30 seconds)
  console.log("✓ Setting up new goal monitoring interval (30 seconds)");
  goalMonitorService.monitorInterval = setInterval(() => {
    console.log("🔄 Running scheduled goal monitor check");
    goalMonitorService.monitorAllGoals(bot).catch(err => {
      console.error("Error in goal check:", err);
    });
  }, 30 * 1000); // 30 seconds
  
  // 4. Fix notifier service too
  console.log("✓ Forcing immediate status check for all streamers");
  if (notifierService.streamCheckInterval) {
    clearInterval(notifierService.streamCheckInterval);
    notifierService.streamCheckInterval = null;
    console.log("✓ Cleared existing notifier interval");
  }
  
  // 5. Force an immediate check of all streamers
  notifierService.checkAllStreamers(bot).catch(err => {
    console.error("Error in forced streamer check:", err);
  });
  
  // 6. Set up a new, more frequent interval for status checks (every 90 seconds)
  console.log("✓ Setting up new notifier interval (90 seconds)");
  notifierService.streamCheckInterval = setInterval(() => {
    console.log("🔄 Running scheduled notifier check");
    notifierService.checkAllStreamers(bot).catch(err => {
      console.error("Error in notifier check:", err);
    });
  }, 90 * 1000); // 90 seconds
  
  console.log("🔧 MONITORING FIX APPLIED - SHOULD START WORKING IMMEDIATELY");
}

// Export the fix function
module.exports = { fixMonitoring };

// Auto-run if executed directly
if (require.main === module) {
  console.log("⚠️ Running monitoring fix as standalone script");
  
  if (!global.botInstance) {
    console.error("❌ Bot instance not available in global scope!");
    console.log("⚠️ You should add this file to index.js instead of running it directly");
    process.exit(1);
  }
  
  fixMonitoring();
}