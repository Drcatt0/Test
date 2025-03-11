/**
 * Upload Service for Glitch file hosting
 */
const fs = require('fs-extra');
const axios = require('axios');
const FormData = require('form-data');
const config = require('../config/config');

/**
 * Wake up the Glitch server before making a request
 * @returns {Promise<boolean>} True if the server is awake
 */
async function wakeGlitchServer() {
  try {
    console.log("Pinging Glitch server to wake it up...");
    await axios.get(`${config.GLITCH_APP_URL}/ping`, { 
      timeout: 10000 // 10 second timeout for the wake-up ping
    });
    console.log("Glitch server is awake!");
    return true;
  } catch (error) {
    console.log("Glitch server wake-up ping failed, but continuing with upload anyway");
    return false;
  }
}

/**
 * Upload file to Glitch for hosting with retries
 * @param {string} filePath - Path to the file to upload
 * @param {string} fileType - MIME type of the file
 * @param {Object} metadata - Additional metadata about the file
 * @param {number} maxRetries - Maximum number of retry attempts
 * @returns {Promise<string>} URL to the uploaded file
 */
async function uploadToGlitch(filePath, fileType, metadata, maxRetries = 3) {
  // First, try to wake up the Glitch server
  await wakeGlitchServer();
  
  // Try the upload with retries
  let lastError = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Upload attempt ${attempt}/${maxRetries}...`);
      
      const formData = new FormData();
      formData.append('file', fs.createReadStream(filePath));
      formData.append('apiKey', config.GLITCH_API_KEY);
      formData.append('metadata', JSON.stringify(metadata));
      formData.append('fileType', fileType);
      
      const response = await axios.post(`${config.GLITCH_APP_URL}/upload`, formData, {
        headers: {
          ...formData.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 60000 // Increased timeout to 60 seconds to give Glitch time to process
      });
      
      if (response.data && response.data.url) {
        console.log(`Upload successful on attempt ${attempt}`);
        return response.data.url;
      } else {
        throw new Error('Invalid response from Glitch');
      }
    } catch (error) {
      lastError = error;
      console.error(`Upload attempt ${attempt} failed:`, error.message);
      
      // If we've reached max retries, throw the error
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Wait before retrying with exponential backoff
      const backoffMs = Math.min(30000, 1000 * Math.pow(2, attempt)); // Max 30 seconds
      console.log(`Waiting ${backoffMs}ms before retrying...`);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }
  
  throw lastError || new Error('Failed to upload to Glitch after multiple attempts');
}

module.exports = {
  wakeGlitchServer,
  uploadToGlitch
};
