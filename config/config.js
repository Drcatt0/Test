/**
 * Bot Configuration
 * Optimized for reduced network usage
 */
module.exports = {
  // Bot token from BotFather
  BOT_TOKEN: "7636575102:AAHGoM2UYWjl1HC7E2DSxCrhDFQ5QDsutJw",
  
  // Path to JSON data files
  JSON_FILE_PATH: './data/monitoredUsers.json',
  PREMIUM_USERS_PATH: './data/premiumUsers.json',
  AUTO_RECORD_CONFIG_PATH: './data/autoRecordConfig.json',
  
  
  // Premium settings
  PREMIUM_KEYS: {
    'ALPHA-TEST-KEY-2024': {
      used: false,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days expiration
    }
  },
  
  // Recording settings
  FREE_USER_MAX_DURATION: 45, // seconds
  FREE_USER_COOLDOWN: 3 * 60 * 1000, // 3 minutes in milliseconds
  PREMIUM_USER_MAX_DURATION: 1800, // 30 minutes in seconds (increased from 20 minutes)
  
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
  BROWSER_INACTIVITY_TIMEOUT: 10 * 60 * 1000, // 10 minutes in milliseconds (increased from 5)
  
  // Monitoring intervals - OPTIMIZED
  MONITOR_INTERVAL: 10 * 60 * 1000, // Check every 10 minutes (increased from 5)
  GOAL_CHECK_INTERVAL: 30 * 1000, // Check goals every 30 seconds (increased from 15)
  MEMORY_CHECK_INTERVAL: 10 * 60 * 1000, // Check memory every 10 minutes (increased from 5)
  FILE_CLEANUP_INTERVAL: 60 * 60 * 1000, // Clean files every 60 minutes (increased from 30)
  RECORDING_CLEANUP_INTERVAL: 2 * 60 * 1000, // Clean stale recordings every 2 minutes (increased from 1)
  
  // Browser pool settings
  BROWSER_POOL_SIZE: 3, // Decreased from 5 to 3 for less memory and network usage
  
  // Cache settings
  STATUS_CACHE_TIME: 2 * 60 * 1000, // Status cache validity: 2 minutes
  OFFLINE_CACHE_TIME: 5 * 60 * 1000, // Offline status cache validity: 5 minutes
  GOAL_CACHE_TIME: 30 * 1000, // Goal status cache: 30 seconds

  // Browser optimization
  BROWSER_REQUEST_TIMEOUT: 15000, // 15 seconds timeout for browser requests
  BROWSER_PAGE_TIMEOUT: 3000, // 3 seconds timeout for page loads
  
  // Batch processing optimization
  STATUS_CHECK_BATCH_SIZE: 5, // Process 5 users at a time (was higher)
  STATUS_CHECK_BATCH_DELAY: 1000, // 1 second delay between batches
  
  // Maximum auto-record monitors per user
  MAX_AUTO_RECORD_MONITORS: 3,
  FILE_SERVER_URL: 'http://98.32.82.246:3000', // Change to your server's public URL
  FILE_SERVER_PORT: 3000,
  FILE_STORAGE_PATH: './recordings', // Path to store recordings
  FILE_RETENTION_DAYS: 7, // Auto-delete files older than this
  
  // Concurrent operations settings
  MAX_CONCURRENT_RECORDINGS: 5, // Allow up to 5 recordings at once
  COMMAND_TIMEOUT: 60 * 1000 // Default timeout for commands (1 minute)
};