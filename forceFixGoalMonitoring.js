/**
 * Emergency fix for goal monitoring
 * This directly initializes the active monitors and forces them to run
 */
const fs = require('fs');
const { Telegraf } = require('telegraf');
const config = require('./config/config');
const monitoredUsersModel = require('./models/monitoredUsers');
const autoRecordConfigModel = require('./models/autoRecordConfig');

// Get goal monitoring service
const goalMonitorService = require('./services/goalMonitorService');

async function emergencyFix() {
  console.log("🚨 RUNNING EMERGENCY GOAL MONITORING FIX");
  
  // Create a temporary bot instance if needed
  const bot = new Telegraf(config.BOT_TOKEN);
  
  // 1. Force load the monitored users
  const users = await monitoredUsersModel.loadMonitoredUsers();
  console.log(`Loaded ${users.length} monitored users`);
  
  // 2. Load auto-record config
  const autoConfig = await autoRecordConfigModel.loadAutoRecordConfig();
  console.log(`Loaded auto-record config for ${Object.keys(autoConfig).length} users`);
  
  // 3. CLEAR the active goal monitors Map (in case it's corrupted)
  goalMonitorService.activeGoalMonitors.clear();
  console.log("Cleared existing goal monitors");
  
  // 4. Directly add each live streamer to the monitors
  let addedCount = 0;
  for (const user of users) {
    if (user.isLive) {
      // Get the user IDs from auto-record config
      const userIds = [];
      const chatIds = [user.chatId];
      
      // Find eligible users for this streamer
      for (const [userId, config] of Object.entries(autoConfig)) {
        if (config.enabled && (
          config.usernames.length === 0 || 
          config.usernames.some(u => u.toLowerCase() === user.username.toLowerCase())
        )) {
          userIds.push(userId);
        }
      }
      
      // Only add if there are eligible users
      if (userIds.length > 0) {
        // Directly add to the monitor Map
        goalMonitorService.activeGoalMonitors.set(user.username.toLowerCase(), {
          lastChecked: Date.now(),
          isLive: true,
          goal: {
            active: user.hasGoal || false,
            progress: user.goalProgress || 0,
            text: user.goalText || '',
            completed: user.goalCompleted || false
          },
          chatIds: new Set(chatIds.map(id => id.toString())),
          userIds: new Set(userIds.map(id => id.toString())),
          failCount: 0
        });
        
        addedCount++;
        console.log(`Added ${user.username} to goal monitors (${userIds.length} users)`);
      }
    }
  }
  
  // 5. Force run the monitor check
  console.log(`Added ${addedCount} streamers to goal monitors`);
  console.log(`Active goal monitors: ${goalMonitorService.activeGoalMonitors.size}`);
  
  // 6. Fix the monitor interval - clear any existing one and create a new one
  if (goalMonitorService.monitorInterval) {
    clearInterval(goalMonitorService.monitorInterval);
  }
  
  // 7. Force a check
  console.log("Forcing goal monitor check...");
  await goalMonitorService.monitorAllGoals(bot);
  
  // 8. Start a new interval
  goalMonitorService.monitorInterval = setInterval(async () => {
    console.log("Running scheduled goal monitor check");
    try {
      await goalMonitorService.monitorAllGoals(bot);
    } catch (err) {
      console.error("Error in goal monitor check:", err);
    }
  }, 30 * 1000); // Every 30 seconds
  
  console.log("🔧 EMERGENCY FIX COMPLETE - Goal monitoring should now work");
  console.log("The monitors will check every 30 seconds");
  
  // Don't exit - keep running to maintain the interval
  console.log("Press Ctrl+C to exit this fix script (but monitoring will stop)");
}

// Run the emergency fix
emergencyFix().catch(err => {
  console.error("Error in emergency fix:", err);
});