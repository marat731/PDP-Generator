const express = require('express');
const path = require('path');
const initSqlJs = require('sql.js');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let db;

async function initDatabase() {
    const SQL = await initSqlJs();
    db = new SQL.Database();
    
    db.run(`
        CREATE TABLE IF NOT EXISTS mockups (
            id TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            password_hash TEXT,
            views INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    console.log('Database initialized');
}

function generateId() {
    return crypto.randomBytes(4).toString('hex');
}

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// Dashboard - root page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Editor page
app.get('/editor', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// List all mockups (for dashboard)
app.get('/api/mockups', (req, res) => {
    try {
        const stmt = db.prepare('SELECT id, data, password_hash, views, created_at, updated_at FROM mockups ORDER BY updated_at DESC');
        const mockups = [];
        
        while (stmt.step()) {
            const row = stmt.getAsObject();
            mockups.push({
                id: row.id,
                data: JSON.parse(row.data),
                password_hash: row.password_hash ? true : false, // Just indicate if password protected
                views: row.views,
                created_at: row.created_at,
                updated_at: row.updated_at
            });
        }
        stmt.free();
        
        res.json({ success: true, mockups });
    } catch (error) {
        console.error('Error listing mockups:', error);
        res.status(500).json({ success: false, error: 'Failed to list mockups' });
    }
});

// Create mockup
app.post('/api/mockups', (req, res) => {
    try {
        const { data, password } = req.body;
        const id = generateId();
        const passwordHash = password ? hashPassword(password) : null;
        
        db.run(
            'INSERT INTO mockups (id, data, password_hash) VALUES (?, ?, ?)',
            [id, JSON.stringify(data), passwordHash]
        );
        
        res.json({ success: true, id });
    } catch (error) {
        console.error('Error creating mockup:', error);
        res.status(500).json({ success: false, error: 'Failed to create mockup' });
    }
});

// Get mockup
app.get('/api/mockups/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { password } = req.query;
        
        const stmt = db.prepare('SELECT * FROM mockups WHERE id = ?');
        stmt.bind([id]);
        
        if (!stmt.step()) {
            stmt.free();
            return res.status(404).json({ success: false, error: 'Mockup not found' });
        }
        
        const row = stmt.getAsObject();
        stmt.free();
        
        // Check password if protected
        if (row.password_hash) {
            if (!password) {
                return res.json({ success: false, passwordProtected: true });
            }
            if (hashPassword(password) !== row.password_hash) {
                return res.status(401).json({ success: false, error: 'Invalid password' });
            }
        }
        
        // Increment views
        db.run('UPDATE mockups SET views = views + 1 WHERE id = ?', [id]);
        
        res.json({
            success: true,
            data: JSON.parse(row.data),
            views: row.views + 1
        });
    } catch (error) {
        console.error('Error getting mockup:', error);
        res.status(500).json({ success: false, error: 'Failed to get mockup' });
    }
});

// Update mockup
app.put('/api/mockups/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { data, password } = req.body;
        const passwordHash = password ? hashPassword(password) : null;
        
        db.run(
            'UPDATE mockups SET data = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [JSON.stringify(data), passwordHash, id]
        );
        
        res.json({ success: true, id });
    } catch (error) {
        console.error('Error updating mockup:', error);
        res.status(500).json({ success: false, error: 'Failed to update mockup' });
    }
});

// Delete mockup
app.delete('/api/mockups/:id', (req, res) => {
    try {
        const { id } = req.params;
        
        db.run('DELETE FROM mockups WHERE id = ?', [id]);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting mockup:', error);
        res.status(500).json({ success: false, error: 'Failed to delete mockup' });
    }
});

// Viewer page
app.get('/mockup/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'viewer.html'));
});

// Start server
initDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
});
