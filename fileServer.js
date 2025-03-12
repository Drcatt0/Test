/**
 * Self-hosted file server for hosting recordings
 * This replaces the Glitch hosting service
 */
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const https = require('https');
const http = require('http');

// Create express app
const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all routes
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  next();
});

// Recordings directory
const RECORDINGS_DIR = path.join(__dirname, 'recordings');

// Ensure recordings directory exists
fs.ensureDirSync(RECORDINGS_DIR);

// Root endpoint
app.get('/', (req, res) => {
  res.send('Stripchat Recorder File Server');
});

// API endpoint for health checks
app.get('/ping', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API key middleware
const API_KEY = '1234ghj'; // Use the same API key from your config
const authenticateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  if (!apiKey || apiKey !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized - Invalid API key' });
  }
  next();
};

// File upload endpoint
app.post('/upload', authenticateApiKey, async (req, res) => {
  try {
    // Generate unique file ID
    const fileId = `${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    
    // Prepare file path
    const fileExtension = req.query.fileType === 'video/mp4' ? 'mp4' : 'bin';
    const fileName = `${fileId}.${fileExtension}`;
    const filePath = path.join(RECORDINGS_DIR, fileName);
    
    // Create write stream
    const fileStream = fs.createWriteStream(filePath);
    
    // Store metadata if provided
    let metadata = {};
    if (req.query.metadata) {
      try {
        metadata = JSON.parse(req.query.metadata);
        // Save metadata to a separate file
        await fs.writeFile(
          path.join(RECORDINGS_DIR, `${fileId}.json`),
          JSON.stringify(metadata, null, 2)
        );
      } catch (e) {
        console.error('Error parsing metadata:', e);
      }
    }
    
    // Pipe request body to file
    req.pipe(fileStream);
    
    // Handle completion
    req.on('end', () => {
      // Generate URL
      const fileUrl = `${req.protocol}://${req.get('host')}/download/${fileId}`;
      
      res.status(200).json({
        success: true,
        message: 'File uploaded successfully',
        fileId: fileId,
        url: fileUrl,
        metadata: metadata
      });
    });
    
    // Handle errors
    fileStream.on('error', (err) => {
      console.error('Error writing file:', err);
      res.status(500).json({ error: 'Error saving file' });
    });
    
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// File download endpoint
app.get('/download/:fileId', async (req, res) => {
  try {
    const fileId = req.params.fileId;
    
    // Check if file exists
    const mp4Path = path.join(RECORDINGS_DIR, `${fileId}.mp4`);
    const binPath = path.join(RECORDINGS_DIR, `${fileId}.bin`);
    const metadataPath = path.join(RECORDINGS_DIR, `${fileId}.json`);
    
    let filePath;
    let contentType;
    
    if (await fs.pathExists(mp4Path)) {
      filePath = mp4Path;
      contentType = 'video/mp4';
    } else if (await fs.pathExists(binPath)) {
      filePath = binPath;
      contentType = 'application/octet-stream';
    } else {
      return res.status(404).send('File not found');
    }
    
    // Get file stats
    const stat = await fs.stat(filePath);
    const fileSize = stat.size;
    
    // Load metadata if exists
    let metadata = {};
    if (await fs.pathExists(metadataPath)) {
      try {
        const metadataContent = await fs.readFile(metadataPath, 'utf8');
        metadata = JSON.parse(metadataContent);
      } catch (e) {
        console.error('Error reading metadata:', e);
      }
    }
    
    // Parse range header for resumable downloads
    const range = req.headers.range;
    
    if (range) {
      // Parse range header
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = (end - start) + 1;
      
      // Create read stream
      const stream = fs.createReadStream(filePath, { start, end });
      
      // Set headers
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${metadata.username || 'recording'}_${metadata.timestamp || fileId}.mp4"`
      });
      
      // Pipe stream
      stream.pipe(res);
    } else {
      // Send entire file
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${metadata.username || 'recording'}_${metadata.timestamp || fileId}.mp4"`
      });
      
      // Create read stream
      const stream = fs.createReadStream(filePath);
      
      // Pipe stream
      stream.pipe(res);
    }
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).send('Internal server error');
  }
});

// List files endpoint (admin only)
app.get('/admin/files', authenticateApiKey, async (req, res) => {
  try {
    const files = await fs.readdir(RECORDINGS_DIR);
    
    // Group files by ID
    const fileMap = {};
    files.forEach(file => {
      const match = file.match(/^(.+)\.(mp4|bin|json)$/);
      if (match) {
        const [, id, ext] = match;
        if (!fileMap[id]) {
          fileMap[id] = {};
        }
        fileMap[id][ext] = file;
      }
    });
    
    // Convert to array with metadata
    const fileList = [];
    for (const [id, fileInfo] of Object.entries(fileMap)) {
      let metadata = {};
      if (fileInfo.json) {
        try {
          const metadataContent = await fs.readFile(
            path.join(RECORDINGS_DIR, fileInfo.json),
            'utf8'
          );
          metadata = JSON.parse(metadataContent);
        } catch (e) {}
      }
      
      let fileSize = 0;
      if (fileInfo.mp4) {
        const stats = await fs.stat(path.join(RECORDINGS_DIR, fileInfo.mp4));
        fileSize = stats.size;
      } else if (fileInfo.bin) {
        const stats = await fs.stat(path.join(RECORDINGS_DIR, fileInfo.bin));
        fileSize = stats.size;
      }
      
      fileList.push({
        id,
        url: `${req.protocol}://${req.get('host')}/download/${id}`,
        size: fileSize,
        metadata,
        created: new Date(parseInt(id.split('_')[0])).toISOString()
      });
    }
    
    // Sort by creation date (newest first)
    fileList.sort((a, b) => new Date(b.created) - new Date(a.created));
    
    res.json(fileList);
  } catch (error) {
    console.error('Error listing files:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete file endpoint (admin only)
app.delete('/admin/files/:fileId', authenticateApiKey, async (req, res) => {
  try {
    const fileId = req.params.fileId;
    
    // Check if files exist
    const mp4Path = path.join(RECORDINGS_DIR, `${fileId}.mp4`);
    const binPath = path.join(RECORDINGS_DIR, `${fileId}.bin`);
    const metadataPath = path.join(RECORDINGS_DIR, `${fileId}.json`);
    
    let deleted = false;
    
    // Delete files if they exist
    if (await fs.pathExists(mp4Path)) {
      await fs.unlink(mp4Path);
      deleted = true;
    }
    
    if (await fs.pathExists(binPath)) {
      await fs.unlink(binPath);
      deleted = true;
    }
    
    if (await fs.pathExists(metadataPath)) {
      await fs.unlink(metadataPath);
    }
    
    if (deleted) {
      res.json({ success: true, message: 'Files deleted successfully' });
    } else {
      res.status(404).json({ error: 'File not found' });
    }
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Cleanup old files (files older than 7 days)
async function cleanupOldFiles() {
  try {
    console.log('Running file cleanup...');
    
    const files = await fs.readdir(RECORDINGS_DIR);
    const now = Date.now();
    const MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
    
    let deletedCount = 0;
    
    for (const file of files) {
      try {
        const match = file.match(/^(\d+)_/);
        if (match) {
          const timestamp = parseInt(match[1], 10);
          const age = now - timestamp;
          
          if (age > MAX_AGE) {
            await fs.unlink(path.join(RECORDINGS_DIR, file));
            deletedCount++;
          }
        }
      } catch (e) {
        console.error('Error processing file during cleanup:', e);
      }
    }
    
    if (deletedCount > 0) {
      console.log(`Cleaned up ${deletedCount} old files`);
    }
  } catch (error) {
    console.error('Error during file cleanup:', error);
  }
}

// Run cleanup every day
setInterval(cleanupOldFiles, 24 * 60 * 60 * 1000);

// Start the server
function startServer() {
  // Check if SSL certificates exist for HTTPS
  const sslOptions = {
    key: path.join(__dirname, 'ssl', 'private.key'),
    cert: path.join(__dirname, 'ssl', 'certificate.crt')
  };
  
  let server;
  
  // Try to start HTTPS server if SSL files exist
  if (fs.existsSync(sslOptions.key) && fs.existsSync(sslOptions.cert)) {
    try {
      const ssl = {
        key: fs.readFileSync(sslOptions.key),
        cert: fs.readFileSync(sslOptions.cert)
      };
      
      server = https.createServer(ssl, app);
      console.log('Starting server with HTTPS...');
    } catch (e) {
      console.error('Error loading SSL certificates:', e);
      console.log('Falling back to HTTP...');
      server = http.createServer(app);
    }
  } else {
    // Fall back to HTTP
    console.log('SSL certificates not found, starting with HTTP...');
    server = http.createServer(app);
  }
  
  // Start listening
  server.listen(PORT, () => {
    console.log(`File server running on port ${PORT}`);
    console.log(`🌐 Server URL: ${server instanceof https.Server ? 'https' : 'http'}://localhost:${PORT}`);
  });
  
  // Handle errors
  server.on('error', (error) => {
    console.error('Server error:', error);
    
    // If port is in use, try another port
    if (error.code === 'EADDRINUSE') {
      console.log(`Port ${PORT} is already in use, trying port ${PORT + 1}...`);
      const newPort = PORT + 1;
      
      // Update port and retry
      server.listen(newPort, () => {
        console.log(`File server running on port ${newPort}`);
        console.log(`🌐 Server URL: ${server instanceof https.Server ? 'https' : 'http'}://localhost:${newPort}`);
      });
    }
  });
  
  return server;
}

// Export the app and startup function
module.exports = {
  app,
  startServer
};

// Auto-start if this file is run directly
if (require.main === module) {
  startServer();
}