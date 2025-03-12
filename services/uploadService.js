/**
 * Upload Service for local file hosting (replaces Glitch)
 */
const fs = require('fs-extra');
const path = require('path');
const http = require('http');
const https = require('https');
const url = require('url');
const config = require('../config/config');

// Define server URL from config
const SERVER_URL = config.FILE_SERVER_URL || 'http://localhost:3000';
const API_KEY = config.GLITCH_API_KEY || '1234ghj'; // Reuse the same API key

/**
 * Wake up the file server before making a request
 * @returns {Promise<boolean>} True if the server is awake
 */
async function wakeFileServer() {
  return new Promise((resolve) => {
    try {
      console.log("Pinging file server to make sure it's running...");
      
      // Parse the server URL
      const parsedUrl = url.parse(SERVER_URL);
      const httpModule = parsedUrl.protocol === 'https:' ? https : http;
      
      // Create the request options
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: '/ping',
        method: 'GET',
        timeout: 5000, // 5 second timeout
        headers: {
          'X-API-Key': API_KEY
        }
      };
      
      // Make the request
      const req = httpModule.request(options, (res) => {
        if (res.statusCode === 200) {
          console.log("File server is responsive!");
          
          // Consume response data to free up memory
          res.resume();
          
          resolve(true);
        } else {
          console.warn(`File server returned status code ${res.statusCode}`);
          resolve(false);
        }
      });
      
      req.on('error', (e) => {
        console.warn(`File server ping failed: ${e.message}`);
        resolve(false);
      });
      
      req.on('timeout', () => {
        console.warn('File server ping timed out');
        req.destroy();
        resolve(false);
      });
      
      req.end();
      
    } catch (error) {
      console.warn('Error pinging file server:', error);
      resolve(false);
    }
  });
}

/**
 * Upload file to local server with retries
 * @param {string} filePath - Path to the file to upload
 * @param {string} fileType - MIME type of the file
 * @param {Object} metadata - Additional metadata about the file
 * @param {number} maxRetries - Maximum number of retry attempts
 * @returns {Promise<string>} URL to the uploaded file
 */
async function uploadToServer(filePath, fileType = 'video/mp4', metadata = {}, maxRetries = 3) {
  // First, check if server is available
  const isServerAwake = await wakeFileServer();
  
  if (!isServerAwake) {
    console.warn("File server appears to be down. Starting it if possible...");
    
    // Try to start the server if it's in the same project
    try {
      const fileServer = require('./fileServer');
      if (fileServer && fileServer.startServer) {
        console.log("Attempting to start file server...");
        fileServer.startServer();
        
        // Give it a moment to start
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (e) {
      console.error("Could not start file server:", e);
    }
  }
  
  // Try upload with retries
  let lastError = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Upload attempt ${attempt}/${maxRetries}...`);
      
      // Parse the server URL
      const parsedUrl = url.parse(SERVER_URL);
      const httpModule = parsedUrl.protocol === 'https:' ? https : http;
      
      // Read file data
      const fileData = await fs.readFile(filePath);
      
      // Create the upload URL with query parameters for metadata
      const metadataParam = encodeURIComponent(JSON.stringify(metadata));
      const uploadPath = `/upload?apiKey=${API_KEY}&fileType=${encodeURIComponent(fileType)}&metadata=${metadataParam}`;
      
      // Create the request options
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: uploadPath,
        method: 'POST',
        headers: {
          'Content-Type': fileType,
          'Content-Length': fileData.length,
          'X-API-Key': API_KEY
        }
      };
      
      // Make the request
      const uploadResult = await new Promise((resolve, reject) => {
        const req = httpModule.request(options, (res) => {
          let responseData = '';
          
          res.on('data', (chunk) => {
            responseData += chunk;
          });
          
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                const parsedResponse = JSON.parse(responseData);
                resolve(parsedResponse);
              } catch (e) {
                reject(new Error(`Invalid JSON response: ${responseData}`));
              }
            } else {
              reject(new Error(`Server returned status code ${res.statusCode}: ${responseData}`));
            }
          });
        });
        
        req.on('error', reject);
        
        // Set timeout (2 minutes should be plenty for any reasonable file size)
        req.setTimeout(120000, () => {
          req.destroy();
          reject(new Error('Upload request timed out'));
        });
        
        // Send the file data
        req.write(fileData);
        req.end();
      });
      
      if (uploadResult && uploadResult.url) {
        console.log(`Upload successful on attempt ${attempt}`);
        return uploadResult.url;
      } else {
        throw new Error('Invalid response from file server');
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
  
  throw lastError || new Error('Failed to upload file after multiple attempts');
}

// Backward compatibility for Glitch usage
const uploadToGlitch = uploadToServer;

module.exports = {
  wakeFileServer,
  uploadToServer,
  uploadToGlitch  // For backward compatibility
};