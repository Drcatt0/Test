/**
 * Record Command Handler with Time Format Support
 */
const recordService = require('../../services/recordService');

/**
 * Parse time input to seconds
 * Accepts formats like:
 * - Plain numbers (interpreted as seconds)
 * - "30s" or "30sec" (seconds)
 * - "5m" or "5min" (minutes)
 * - "1h" or "1hour" (hours)
 */
function parseTimeToSeconds(timeInput) {
  const timeStr = timeInput.toString().toLowerCase().trim();
  
  // Check for time units
  if (timeStr.endsWith('s') || timeStr.endsWith('sec') || timeStr.endsWith('seconds') || timeStr.endsWith('second')) {
    // Seconds format
    const seconds = parseInt(timeStr.replace(/[^\d.]/g, ''), 10);
    return isNaN(seconds) ? 0 : seconds;
  } else if (timeStr.endsWith('m') || timeStr.endsWith('min') || timeStr.endsWith('minutes') || timeStr.endsWith('minute')) {
    // Minutes format
    const minutes = parseInt(timeStr.replace(/[^\d.]/g, ''), 10);
    return isNaN(minutes) ? 0 : minutes * 60;
  } else if (timeStr.endsWith('h') || timeStr.endsWith('hour') || timeStr.endsWith('hours')) {
    // Hours format
    const hours = parseInt(timeStr.replace(/[^\d.]/g, ''), 10);
    return isNaN(hours) ? 0 : hours * 3600;
  } else {
    // Assume plain seconds
    const seconds = parseInt(timeStr, 10);
    return isNaN(seconds) ? 0 : seconds;
  }
}

/**
 * /record - Record a live stream
 */
async function handler(ctx) {
  const args = ctx.message.text.split(' ').slice(1);
  
  if (args.length < 2) {
    return ctx.reply("Usage: /record username duration\n\nExamples:\n/record AlicePlayss 60\n/record AlicePlayss 10m\n/record AlicePlayss 1h");
  }

  const username = args[0];
  const durationInput = args[1];
  
  // Parse the duration with time format support
  const duration = parseTimeToSeconds(durationInput);
  
  if (duration <= 0) {
    return ctx.reply("Please provide a valid duration like '30s', '10m', or '1h'.");
  }
  
  await recordService.executeRecord(ctx, username, duration);
}

module.exports = {
  handler,
  parseTimeToSeconds
};