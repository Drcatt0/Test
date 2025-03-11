/**
 * Bot Configuration
 */
module.exports = {
  // Bot token from BotFather
  BOT_TOKEN: "7636575102:AAHGoM2UYWjl1HC7E2DSxCrhDFQ5QDsutJw",
  
  // Path to JSON data files
  JSON_FILE_PATH: './data/monitoredUsers.json',
  PREMIUM_USERS_PATH: './data/premiumUsers.json',
  AUTO_RECORD_CONFIG_PATH: './data/autoRecordConfig.json',
  
  // Glitch configuration for file hosting
  GLITCH_APP_URL: 'https://stripcht-files.glitch.me', // Glitch server URL
  GLITCH_API_KEY: '1234ghj', // API key for authentication
  
  // Premium settings
  PREMIUM_KEYS: {
    'ALPHA-TEST-KEY-2024': {
      used: false,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days expiration
    }
  },
  
  // Recording settings
  FREE_USER_MAX_DURATION: 30, // seconds
  FREE_USER_COOLDOWN: 3 * 60 * 1000, // 3 minutes in milliseconds
  PREMIUM_USER_MAX_DURATION: 600, // 10 minutes in seconds
  
  // Browser settings
  BROWSER_ARGS: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--disable-gpu',
    '--js-flags=--max-old-space-size=256' // Limit JS heap size
  ],
  
  // FFmpeg settings for recording
  FFMPEG_RECORDING_ARGS: [
    '-c:v', 'libx264',     // Use H.264 codec for video
    '-c:a', 'aac',         // Use AAC for audio
    '-b:v', '2500k',       // Video bitrate
    '-b:a', '128k',        // Audio bitrate
    '-vf', 'scale=1280:720,setsar=1:1',  // Force 16:9 aspect ratio at 720p
    '-preset', 'fast',     // Encoding preset (fast)
    '-y',                  // Overwrite output file if exists
    '-err_detect', 'ignore_err',
    '-reconnect', '1',
    '-reconnect_at_eof', '1',
    '-reconnect_streamed', '1', 
    '-reconnect_delay_max', '5'
  ],
  
  // Memory management thresholds
  MAX_MEMORY_USAGE_MB: 500,
  BROWSER_INACTIVITY_TIMEOUT: 5 * 60 * 1000, // 5 minutes in milliseconds
  
  // Monitoring intervals
  MONITOR_INTERVAL: 60 * 1000, // Check every minute
  MEMORY_CHECK_INTERVAL: 5 * 60 * 1000, // Check memory every 5 minutes
  FILE_CLEANUP_INTERVAL: 30 * 60 * 1000, // Clean files every 30 minutes
  RECORDING_CLEANUP_INTERVAL: 60 * 1000, // Clean stale recordings every minute
};
