const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

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

// ============ MOCKUPS API ============

// List all mockups (for dashboard)
app.get('/api/mockups', async (req, res) => {
    try {
        const { data: mockups, error } = await supabase
            .from('mockups')
            .select('*')
            .order('updated_at', { ascending: false });

        if (error) throw error;

        // Get unresolved comment counts for each mockup
        const mockupsWithCounts = await Promise.all(mockups.map(async (mockup) => {
            const { count, error: countError } = await supabase
                .from('comments')
                .select('*', { count: 'exact', head: true })
                .eq('mockup_id', mockup.id)
                .eq('resolved', false);

            return {
                id: mockup.id,
                data: mockup.data,
                hasPassword: !!mockup.password_hash,
                views: mockup.views,
                currentVersion: mockup.current_version,
                unresolvedComments: count || 0,
                created_at: mockup.created_at,
                updated_at: mockup.updated_at
            };
        }));

        res.json({ success: true, mockups: mockupsWithCounts });
    } catch (error) {
        console.error('Error listing mockups:', error);
        res.status(500).json({ success: false, error: 'Failed to list mockups' });
    }
});

// Create mockup
app.post('/api/mockups', async (req, res) => {
    try {
        const { data, password } = req.body;
        const id = generateId();
        const passwordHash = password ? hashPassword(password) : null;

        const { error } = await supabase
            .from('mockups')
            .insert({
                id,
                data,
                password_hash: passwordHash,
                current_version: 1,
                views: 0
            });

        if (error) throw error;

        res.json({ success: true, id });
    } catch (error) {
        console.error('Error creating mockup:', error);
        res.status(500).json({ success: false, error: 'Failed to create mockup' });
    }
});

// Get mockup
app.get('/api/mockups/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { password, version } = req.query;

        const { data: mockup, error } = await supabase
            .from('mockups')
            .select('*')
            .eq('id', id)
            .single();

        if (error || !mockup) {
            return res.status(404).json({ success: false, error: 'Mockup not found' });
        }

        if (mockup.password_hash) {
            if (!password) {
                return res.json({ success: false, passwordProtected: true });
            }
            if (hashPassword(password) !== mockup.password_hash) {
                return res.status(401).json({ success: false, error: 'Invalid password' });
            }
        }

        // Increment views
        await supabase
            .from('mockups')
            .update({ views: mockup.views + 1 })
            .eq('id', id);

        // Get list of versions
        const { data: versionsData, error: versionsError } = await supabase
            .from('versions')
            .select('id, version_number, created_at')
            .eq('mockup_id', id)
            .order('version_number', { ascending: true });

        const versions = (versionsData || []).map(v => ({
            id: v.id,
            versionNumber: v.version_number,
            createdAt: v.created_at
        }));

        // Add current version to the list
        versions.push({
            id: 'current',
            versionNumber: mockup.current_version,
            createdAt: mockup.updated_at || mockup.created_at,
            isCurrent: true
        });

        // If requesting a specific archived version
        if (version && version !== 'current' && parseInt(version) !== mockup.current_version) {
            const { data: versionData, error: versionError } = await supabase
                .from('versions')
                .select('data')
                .eq('mockup_id', id)
                .eq('version_number', parseInt(version))
                .single();

            if (versionData) {
                return res.json({
                    success: true,
                    data: versionData.data,
                    views: mockup.views + 1,
                    currentVersion: mockup.current_version,
                    viewingVersion: parseInt(version),
                    versions
                });
            }
        }

        res.json({
            success: true,
            data: mockup.data,
            views: mockup.views + 1,
            currentVersion: mockup.current_version,
            viewingVersion: mockup.current_version,
            versions
        });
    } catch (error) {
        console.error('Error getting mockup:', error);
        res.status(500).json({ success: false, error: 'Failed to get mockup' });
    }
});

// Update mockup
app.put('/api/mockups/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { data, password } = req.body;

        const updateData = { data };
        if (password) {
            updateData.password_hash = hashPassword(password);
        }

        const { error } = await supabase
            .from('mockups')
            .update(updateData)
            .eq('id', id);

        if (error) throw error;

        res.json({ success: true, id });
    } catch (error) {
        console.error('Error updating mockup:', error);
        res.status(500).json({ success: false, error: 'Failed to update mockup' });
    }
});

// Create new version
app.post('/api/mockups/:id/versions', async (req, res) => {
    try {
        const { id } = req.params;

        // Get current mockup
        const { data: mockup, error: mockupError } = await supabase
            .from('mockups')
            .select('data, current_version')
            .eq('id', id)
            .single();

        if (mockupError || !mockup) {
            return res.status(404).json({ success: false, error: 'Mockup not found' });
        }

        const currentVersion = mockup.current_version || 1;

        // Get all comments for current version
        const { data: comments, error: commentsError } = await supabase
            .from('comments')
            .select('*')
            .eq('mockup_id', id)
            .eq('version_number', currentVersion);

        // Archive current version with its comments
        const versionId = generateId();
        const { error: versionError } = await supabase
            .from('versions')
            .insert({
                id: versionId,
                mockup_id: id,
                version_number: currentVersion,
                data: mockup.data,
                comments_snapshot: comments || []
            });

        if (versionError) throw versionError;

        // Increment version number
        const newVersion = currentVersion + 1;
        const { error: updateError } = await supabase
            .from('mockups')
            .update({ current_version: newVersion })
            .eq('id', id);

        if (updateError) throw updateError;

        res.json({
            success: true,
            previousVersion: currentVersion,
            newVersion: newVersion,
            message: `Version ${currentVersion} archived. Now editing version ${newVersion}.`
        });
    } catch (error) {
        console.error('Error creating new version:', error);
        res.status(500).json({ success: false, error: 'Failed to create new version' });
    }
});

// Delete mockup
app.delete('/api/mockups/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Delete in order due to foreign keys (or let CASCADE handle it)
        const { error } = await supabase
            .from('mockups')
            .delete()
            .eq('id', id);

        if (error) throw error;

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting mockup:', error);
        res.status(500).json({ success: false, error: 'Failed to delete mockup' });
    }
});

// ============ COMMENTS API ============

app.get('/api/mockups/:id/comments', async (req, res) => {
    try {
        const { id } = req.params;
        const { version } = req.query;

        // Get mockup's current version if no specific version requested
        let versionToQuery = version;
        if (!versionToQuery) {
            const { data: mockup } = await supabase
                .from('mockups')
                .select('current_version')
                .eq('id', id)
                .single();
            versionToQuery = mockup?.current_version || 1;
        }

        // For archived versions, get from snapshot
        if (version && version !== 'current') {
            const { data: versionData, error: versionError } = await supabase
                .from('versions')
                .select('comments_snapshot')
                .eq('mockup_id', id)
                .eq('version_number', parseInt(version))
                .single();

            if (versionData?.comments_snapshot) {
                const comments = versionData.comments_snapshot.map(row => ({
                    id: row.id,
                    x: row.x,
                    y: row.y,
                    width: row.width,
                    height: row.height,
                    imageIndex: row.image_index,
                    versionNumber: row.version_number,
                    comment: row.comment,
                    author: row.author,
                    authorToken: row.author_token,
                    resolved: row.resolved,
                    createdAt: row.created_at
                }));
                return res.json({ success: true, comments, version: parseInt(version), isArchived: true });
            }
        }

        // Get live comments for current version
        const { data: comments, error } = await supabase
            .from('comments')
            .select('*')
            .eq('mockup_id', id)
            .eq('version_number', versionToQuery)
            .order('created_at', { ascending: true });

        if (error) throw error;

        const formattedComments = (comments || []).map(row => ({
            id: row.id,
            x: row.x,
            y: row.y,
            width: row.width,
            height: row.height,
            imageIndex: row.image_index,
            versionNumber: row.version_number,
            comment: row.comment,
            author: row.author,
            authorToken: row.author_token,
            resolved: row.resolved,
            createdAt: row.created_at
        }));

        res.json({ success: true, comments: formattedComments, version: versionToQuery, isArchived: false });
    } catch (error) {
        console.error('Error getting comments:', error);
        res.status(500).json({ success: false, error: 'Failed to get comments' });
    }
});

app.post('/api/mockups/:id/comments', async (req, res) => {
    try {
        const { id } = req.params;
        const { x, y, width, height, imageIndex, comment, author, authorToken } = req.body;
        const commentId = generateId();

        // Get current version
        const { data: mockup } = await supabase
            .from('mockups')
            .select('current_version')
            .eq('id', id)
            .single();

        const versionNumber = mockup?.current_version || 1;

        const { error } = await supabase
            .from('comments')
            .insert({
                id: commentId,
                mockup_id: id,
                version_number: versionNumber,
                x,
                y,
                width,
                height,
                image_index: imageIndex,
                comment,
                author,
                author_token: authorToken,
                resolved: false
            });

        if (error) throw error;

        res.json({ success: true, id: commentId });
    } catch (error) {
        console.error('Error adding comment:', error);
        res.status(500).json({ success: false, error: 'Failed to add comment' });
    }
});

app.put('/api/mockups/:id/comments/:commentId', async (req, res) => {
    try {
        const { commentId } = req.params;
        const { comment, authorToken } = req.body;

        // Check authorization
        const { data: existing } = await supabase
            .from('comments')
            .select('author_token')
            .eq('id', commentId)
            .single();

        if (existing && existing.author_token !== authorToken) {
            return res.status(403).json({ success: false, error: 'Not authorized to edit this comment' });
        }

        const { error } = await supabase
            .from('comments')
            .update({ comment })
            .eq('id', commentId);

        if (error) throw error;

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating comment:', error);
        res.status(500).json({ success: false, error: 'Failed to update comment' });
    }
});

// Delete ALL comments for a mockup (designer action)
app.delete('/api/mockups/:id/comments', async (req, res) => {
    try {
        const { id } = req.params;

        const { error } = await supabase
            .from('comments')
            .delete()
            .eq('mockup_id', id);

        if (error) throw error;

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting all comments:', error);
        res.status(500).json({ success: false, error: 'Failed to delete comments' });
    }
});

app.delete('/api/mockups/:id/comments/:commentId', async (req, res) => {
    try {
        const { commentId } = req.params;
        const { authorToken } = req.query;

        // Check authorization if token provided
        if (authorToken) {
            const { data: existing } = await supabase
                .from('comments')
                .select('author_token')
                .eq('id', commentId)
                .single();

            if (existing && existing.author_token !== authorToken) {
                return res.status(403).json({ success: false, error: 'Not authorized to delete this comment' });
            }
        }

        const { error } = await supabase
            .from('comments')
            .delete()
            .eq('id', commentId);

        if (error) throw error;

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting comment:', error);
        res.status(500).json({ success: false, error: 'Failed to delete comment' });
    }
});

app.put('/api/mockups/:id/comments/:commentId/resolve', async (req, res) => {
    try {
        const { commentId } = req.params;
        const { resolved } = req.body;

        const { error } = await supabase
            .from('comments')
            .update({ resolved })
            .eq('id', commentId);

        if (error) throw error;

        res.json({ success: true });
    } catch (error) {
        console.error('Error resolving comment:', error);
        res.status(500).json({ success: false, error: 'Failed to resolve comment' });
    }
});

// ============ VERSIONS API ============

app.get('/api/mockups/:id/versions', async (req, res) => {
    try {
        const { id } = req.params;

        const { data: versions, error } = await supabase
            .from('versions')
            .select('id, version_number, created_at')
            .eq('mockup_id', id)
            .order('version_number', { ascending: false });

        if (error) throw error;

        const formattedVersions = (versions || []).map(v => ({
            id: v.id,
            versionNumber: v.version_number,
            createdAt: v.created_at
        }));

        res.json({ success: true, versions: formattedVersions });
    } catch (error) {
        console.error('Error getting versions:', error);
        res.status(500).json({ success: false, error: 'Failed to get versions' });
    }
});

app.get('/api/mockups/:id/versions/:versionId', async (req, res) => {
    try {
        const { versionId } = req.params;

        const { data: version, error } = await supabase
            .from('versions')
            .select('*')
            .eq('id', versionId)
            .single();

        if (error || !version) {
            return res.status(404).json({ success: false, error: 'Version not found' });
        }

        res.json({
            success: true,
            version: {
                id: version.id,
                mockupId: version.mockup_id,
                versionNumber: version.version_number,
                data: version.data,
                commentsSnapshot: version.comments_snapshot,
                createdAt: version.created_at
            }
        });
    } catch (error) {
        console.error('Error getting version:', error);
        res.status(500).json({ success: false, error: 'Failed to get version' });
    }
});

app.delete('/api/mockups/:id/versions/:versionNum', async (req, res) => {
    try {
        const { id, versionNum } = req.params;

        // Can't delete current version
        const { data: mockup } = await supabase
            .from('mockups')
            .select('current_version')
            .eq('id', id)
            .single();

        if (mockup && parseInt(versionNum) >= mockup.current_version) {
            return res.status(400).json({ success: false, error: 'Cannot delete current version' });
        }

        const { error } = await supabase
            .from('versions')
            .delete()
            .eq('mockup_id', id)
            .eq('version_number', parseInt(versionNum));

        if (error) throw error;

        res.json({ success: true, deletedVersion: parseInt(versionNum) });
    } catch (error) {
        console.error('Error deleting version:', error);
        res.status(500).json({ success: false, error: 'Failed to delete version' });
    }
});

// Viewer page
app.get('/mockup/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'viewer.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Connected to Supabase');
});
