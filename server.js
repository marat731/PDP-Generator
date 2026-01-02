const express = require('express');
const initSqlJs = require('sql.js');
const { nanoid } = require('nanoid');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// Database setup
const dbPath = process.env.DATABASE_PATH || './mockups.db';
let db = null;

async function initDatabase() {
  const SQL = await initSqlJs();
  
  try {
    // Try to load existing database
    if (fs.existsSync(dbPath)) {
      const buffer = fs.readFileSync(dbPath);
      db = new SQL.Database(buffer);
      console.log('📦 Loaded existing database');
    } else {
      db = new SQL.Database();
      console.log('📦 Created new database');
    }
  } catch (error) {
    db = new SQL.Database();
    console.log('📦 Created new database (fallback)');
  }

  // Create table if it doesn't exist
  db.run(`
    CREATE TABLE IF NOT EXISTS mockups (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      password TEXT,
      views INTEGER DEFAULT 0
    )
  `);

  saveDatabase();
}

function saveDatabase() {
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  } catch (error) {
    console.error('Error saving database:', error);
  }
}

// API Routes

// Create new mockup
app.post('/api/mockups', (req, res) => {
  try {
    const { data, password } = req.body;
    const id = nanoid(10);
    
    db.run(
      'INSERT INTO mockups (id, data, password) VALUES (?, ?, ?)',
      [id, JSON.stringify(data), password || null]
    );
    
    saveDatabase();
    
    res.json({ 
      success: true, 
      id,
      url: `${req.protocol}://${req.get('host')}/mockup/${id}`
    });
  } catch (error) {
    console.error('Error creating mockup:', error);
    res.status(500).json({ success: false, error: 'Failed to create mockup' });
  }
});

// Get mockup by ID
app.get('/api/mockups/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.query;
    
    const result = db.exec('SELECT * FROM mockups WHERE id = ?', [id]);
    
    if (!result.length || !result[0].values.length) {
      return res.status(404).json({ success: false, error: 'Mockup not found' });
    }
    
    const row = result[0].values[0];
    const mockup = {
      id: row[0],
      data: row[1],
      created_at: row[2],
      updated_at: row[3],
      password: row[4],
      views: row[5]
    };
    
    // Check password if required
    if (mockup.password && mockup.password !== password) {
      return res.status(401).json({ 
        success: false, 
        error: 'Password required',
        passwordProtected: true 
      });
    }
    
    // Increment view count
    db.run('UPDATE mockups SET views = views + 1 WHERE id = ?', [id]);
    saveDatabase();
    
    res.json({ 
      success: true, 
      data: JSON.parse(mockup.data),
      views: mockup.views + 1,
      created_at: mockup.created_at
    });
  } catch (error) {
    console.error('Error fetching mockup:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch mockup' });
  }
});

// Update existing mockup
app.put('/api/mockups/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { data, password } = req.body;
    
    // Check if mockup exists and password matches
    const result = db.exec('SELECT password FROM mockups WHERE id = ?', [id]);
    
    if (!result.length || !result[0].values.length) {
      return res.status(404).json({ success: false, error: 'Mockup not found' });
    }
    
    const existingPassword = result[0].values[0][0];
    
    if (existingPassword && existingPassword !== password) {
      return res.status(401).json({ success: false, error: 'Invalid password' });
    }
    
    db.run(
      'UPDATE mockups SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [JSON.stringify(data), id]
    );
    
    saveDatabase();
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating mockup:', error);
    res.status(500).json({ success: false, error: 'Failed to update mockup' });
  }
});

// Delete mockup
app.delete('/api/mockups/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;
    
    const result = db.exec('SELECT password FROM mockups WHERE id = ?', [id]);
    
    if (!result.length || !result[0].values.length) {
      return res.status(404).json({ success: false, error: 'Mockup not found' });
    }
    
    const existingPassword = result[0].values[0][0];
    
    if (existingPassword && existingPassword !== password) {
      return res.status(401).json({ success: false, error: 'Invalid password' });
    }
    
    db.run('DELETE FROM mockups WHERE id = ?', [id]);
    saveDatabase();
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting mockup:', error);
    res.status(500).json({ success: false, error: 'Failed to delete mockup' });
  }
});

// Serve mockup viewer page
app.get('/mockup/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'viewer.html'));
});

// Health check for Railway
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Start server
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Walmart Mockup Generator running on port ${PORT}`);
    console.log(`📦 Database: ${dbPath}`);
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  saveDatabase();
  process.exit(0);
});

// Auto-save every 30 seconds
setInterval(() => {
  if (db) saveDatabase();
}, 30000);
