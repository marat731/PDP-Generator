const express = require('express');
const path = require('path');
const initSqlJs = require('sql.js');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

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
            current_version INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS comments (
            id TEXT PRIMARY KEY,
            mockup_id TEXT NOT NULL,
            x REAL NOT NULL,
            y REAL NOT NULL,
            width REAL NOT NULL,
            height REAL NOT NULL,
            comment TEXT NOT NULL,
            author TEXT NOT NULL,
            author_token TEXT NOT NULL,
            resolved INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (mockup_id) REFERENCES mockups(id)
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS versions (
            id TEXT PRIMARY KEY,
            mockup_id TEXT NOT NULL,
            version_number INTEGER NOT NULL,
            data TEXT NOT NULL,
            comments_snapshot TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (mockup_id) REFERENCES mockups(id)
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
        const stmt = db.prepare('SELECT id, data, password_hash, views, current_version, created_at, updated_at FROM mockups ORDER BY updated_at DESC');
        const mockups = [];
        
        while (stmt.step()) {
            const row = stmt.getAsObject();
            const commentStmt = db.prepare('SELECT COUNT(*) as count FROM comments WHERE mockup_id = ? AND resolved = 0');
            commentStmt.bind([row.id]);
            commentStmt.step();
            const commentCount = commentStmt.getAsObject().count;
            commentStmt.free();
            
            mockups.push({
                id: row.id,
                data: JSON.parse(row.data),
                hasPassword: row.password_hash ? true : false,
                views: row.views,
                currentVersion: row.current_version,
                unresolvedComments: commentCount,
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
            'INSERT INTO mockups (id, data, password_hash, current_version) VALUES (?, ?, ?, 1)',
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
        
        if (row.password_hash) {
            if (!password) {
                return res.json({ success: false, passwordProtected: true });
            }
            if (hashPassword(password) !== row.password_hash) {
                return res.status(401).json({ success: false, error: 'Invalid password' });
            }
        }
        
        db.run('UPDATE mockups SET views = views + 1 WHERE id = ?', [id]);
        
        res.json({
            success: true,
            data: JSON.parse(row.data),
            views: row.views + 1,
            currentVersion: row.current_version
        });
    } catch (error) {
        console.error('Error getting mockup:', error);
        res.status(500).json({ success: false, error: 'Failed to get mockup' });
    }
});

// Update mockup (archives old version first)
app.put('/api/mockups/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { data, password } = req.body;
        const passwordHash = password ? hashPassword(password) : null;
        
        const stmt = db.prepare('SELECT data, current_version FROM mockups WHERE id = ?');
        stmt.bind([id]);
        
        if (stmt.step()) {
            const row = stmt.getAsObject();
            const currentVersion = row.current_version || 1;
            const oldData = row.data;
            
            const commentsStmt = db.prepare('SELECT * FROM comments WHERE mockup_id = ?');
            const comments = [];
            commentsStmt.bind([id]);
            while (commentsStmt.step()) {
                comments.push(commentsStmt.getAsObject());
            }
            commentsStmt.free();
            
            const versionId = generateId();
            db.run(
                'INSERT INTO versions (id, mockup_id, version_number, data, comments_snapshot) VALUES (?, ?, ?, ?, ?)',
                [versionId, id, currentVersion, oldData, JSON.stringify(comments)]
            );
            
            db.run(
                'UPDATE mockups SET data = ?, password_hash = ?, current_version = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [JSON.stringify(data), passwordHash, currentVersion + 1, id]
            );
            
            db.run('DELETE FROM comments WHERE mockup_id = ? AND resolved = 1', [id]);
        }
        stmt.free();
        
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
        
        db.run('DELETE FROM comments WHERE mockup_id = ?', [id]);
        db.run('DELETE FROM versions WHERE mockup_id = ?', [id]);
        db.run('DELETE FROM mockups WHERE id = ?', [id]);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting mockup:', error);
        res.status(500).json({ success: false, error: 'Failed to delete mockup' });
    }
});

// ============ COMMENTS API ============

app.get('/api/mockups/:id/comments', (req, res) => {
    try {
        const { id } = req.params;
        const stmt = db.prepare('SELECT * FROM comments WHERE mockup_id = ? ORDER BY created_at ASC');
        stmt.bind([id]);
        
        const comments = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            comments.push({
                id: row.id,
                x: row.x,
                y: row.y,
                width: row.width,
                height: row.height,
                comment: row.comment,
                author: row.author,
                authorToken: row.author_token,
                resolved: row.resolved === 1,
                createdAt: row.created_at
            });
        }
        stmt.free();
        
        res.json({ success: true, comments });
    } catch (error) {
        console.error('Error getting comments:', error);
        res.status(500).json({ success: false, error: 'Failed to get comments' });
    }
});

app.post('/api/mockups/:id/comments', (req, res) => {
    try {
        const { id } = req.params;
        const { x, y, width, height, comment, author, authorToken } = req.body;
        const commentId = generateId();
        
        db.run(
            'INSERT INTO comments (id, mockup_id, x, y, width, height, comment, author, author_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [commentId, id, x, y, width, height, comment, author, authorToken]
        );
        
        res.json({ success: true, id: commentId });
    } catch (error) {
        console.error('Error adding comment:', error);
        res.status(500).json({ success: false, error: 'Failed to add comment' });
    }
});

app.put('/api/mockups/:id/comments/:commentId', (req, res) => {
    try {
        const { commentId } = req.params;
        const { comment, authorToken } = req.body;
        
        const stmt = db.prepare('SELECT author_token FROM comments WHERE id = ?');
        stmt.bind([commentId]);
        if (stmt.step()) {
            const row = stmt.getAsObject();
            if (row.author_token !== authorToken) {
                stmt.free();
                return res.status(403).json({ success: false, error: 'Not authorized to edit this comment' });
            }
        }
        stmt.free();
        
        db.run('UPDATE comments SET comment = ? WHERE id = ?', [comment, commentId]);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating comment:', error);
        res.status(500).json({ success: false, error: 'Failed to update comment' });
    }
});

app.delete('/api/mockups/:id/comments/:commentId', (req, res) => {
    try {
        const { commentId } = req.params;
        const { authorToken } = req.query;
        
        const stmt = db.prepare('SELECT author_token FROM comments WHERE id = ?');
        stmt.bind([commentId]);
        if (stmt.step()) {
            const row = stmt.getAsObject();
            if (authorToken && row.author_token !== authorToken) {
                stmt.free();
                return res.status(403).json({ success: false, error: 'Not authorized to delete this comment' });
            }
        }
        stmt.free();
        
        db.run('DELETE FROM comments WHERE id = ?', [commentId]);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting comment:', error);
        res.status(500).json({ success: false, error: 'Failed to delete comment' });
    }
});

app.put('/api/mockups/:id/comments/:commentId/resolve', (req, res) => {
    try {
        const { commentId } = req.params;
        const { resolved } = req.body;
        
        db.run('UPDATE comments SET resolved = ? WHERE id = ?', [resolved ? 1 : 0, commentId]);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error resolving comment:', error);
        res.status(500).json({ success: false, error: 'Failed to resolve comment' });
    }
});

// ============ VERSIONS API ============

app.get('/api/mockups/:id/versions', (req, res) => {
    try {
        const { id } = req.params;
        const stmt = db.prepare('SELECT id, version_number, created_at FROM versions WHERE mockup_id = ? ORDER BY version_number DESC');
        stmt.bind([id]);
        
        const versions = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            versions.push({
                id: row.id,
                versionNumber: row.version_number,
                createdAt: row.created_at
            });
        }
        stmt.free();
        
        res.json({ success: true, versions });
    } catch (error) {
        console.error('Error getting versions:', error);
        res.status(500).json({ success: false, error: 'Failed to get versions' });
    }
});

app.get('/api/mockups/:id/versions/:versionId', (req, res) => {
    try {
        const { versionId } = req.params;
        const stmt = db.prepare('SELECT * FROM versions WHERE id = ?');
        stmt.bind([versionId]);
        
        if (!stmt.step()) {
            stmt.free();
            return res.status(404).json({ success: false, error: 'Version not found' });
        }
        
        const row = stmt.getAsObject();
        stmt.free();
        
        res.json({
            success: true,
            versionNumber: row.version_number,
            data: JSON.parse(row.data),
            comments: JSON.parse(row.comments_snapshot || '[]'),
            createdAt: row.created_at
        });
    } catch (error) {
        console.error('Error getting version:', error);
        res.status(500).json({ success: false, error: 'Failed to get version' });
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
