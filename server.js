const express = require('express');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// JWT secret - in production, use a strong secret from environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production-' + crypto.randomBytes(16).toString('hex');
const JWT_EXPIRES_IN = '7d'; // Token expires in 7 days

// Gemini API
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());

// Serve static files but not index files (we handle routes manually)
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

function generateId() {
    return crypto.randomBytes(4).toString('hex');
}

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// ============ AUTH MIDDLEWARE ============

function authenticateToken(req, res, next) {
    const token = req.cookies.auth_token;
    
    if (!token) {
        return res.redirect('/login');
    }
    
    try {
        const user = jwt.verify(token, JWT_SECRET);
        req.user = user;
        next();
    } catch (err) {
        res.clearCookie('auth_token');
        return res.redirect('/login');
    }
}

// API version of auth middleware (returns JSON instead of redirect)
function authenticateAPI(req, res, next) {
    const token = req.cookies.auth_token;
    
    if (!token) {
        return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    
    try {
        const user = jwt.verify(token, JWT_SECRET);
        req.user = user;
        next();
    } catch (err) {
        res.clearCookie('auth_token');
        return res.status(401).json({ success: false, error: 'Invalid token' });
    }
}

// ============ AUTH ROUTES ============

// Login page
app.get('/login', (req, res) => {
    // If already logged in, redirect to dashboard
    const token = req.cookies.auth_token;
    if (token) {
        try {
            jwt.verify(token, JWT_SECRET);
            return res.redirect('/');
        } catch (err) {
            // Token invalid, show login page
        }
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Login API
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Email and password required' });
        }
        
        // Find user
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email.toLowerCase())
            .single();
        
        if (error || !user) {
            return res.status(401).json({ success: false, error: 'Invalid email or password' });
        }
        
        // Check password
        if (hashPassword(password) !== user.password_hash) {
            return res.status(401).json({ success: false, error: 'Invalid email or password' });
        }
        
        // Generate JWT
        const token = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                role: user.role 
            }, 
            JWT_SECRET, 
            { expiresIn: JWT_EXPIRES_IN }
        );
        
        // Set cookie
        res.cookie('auth_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });
        
        res.json({ 
            success: true, 
            user: { 
                id: user.id, 
                email: user.email, 
                role: user.role 
            } 
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, error: 'Login failed' });
    }
});

// Logout API
app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('auth_token');
    res.json({ success: true });
});

// Get current user
app.get('/api/auth/me', (req, res) => {
    const token = req.cookies.auth_token;
    
    if (!token) {
        return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    
    try {
        const user = jwt.verify(token, JWT_SECRET);
        res.json({ success: true, user });
    } catch (err) {
        res.clearCookie('auth_token');
        res.status(401).json({ success: false, error: 'Invalid token' });
    }
});

// ============ PROTECTED PAGE ROUTES ============

// Dashboard - protected
app.get('/', authenticateToken, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Editor page - protected
app.get('/editor', authenticateToken, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============ MOCKUPS API (Protected) ============

// List all mockups (for dashboard)
app.get('/api/mockups', authenticateAPI, async (req, res) => {
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

// Create mockup - protected
app.post('/api/mockups', authenticateAPI, async (req, res) => {
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
                views: 0,
                user_id: req.user.id
            });

        if (error) throw error;

        res.json({ success: true, id });
    } catch (error) {
        console.error('Error creating mockup:', error);
        res.status(500).json({ success: false, error: 'Failed to create mockup' });
    }
});

// Get mockup - PUBLIC (for viewer) but also works when authenticated
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

// Update mockup - protected
app.put('/api/mockups/:id', authenticateAPI, async (req, res) => {
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

// Create new version - protected
app.post('/api/mockups/:id/versions', authenticateAPI, async (req, res) => {
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

// Delete mockup - protected
app.delete('/api/mockups/:id', authenticateAPI, async (req, res) => {
    try {
        const { id } = req.params;

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

// ============ COMMENTS API (Mostly Public for clients) ============

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

// Create comment - PUBLIC (clients can leave feedback)
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

// Update comment - PUBLIC (author can edit own comments)
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

// Delete ALL comments for a mockup - protected (designer action)
app.delete('/api/mockups/:id/comments', authenticateAPI, async (req, res) => {
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

// Delete single comment - PUBLIC (author can delete own) or protected (designer can delete any)
app.delete('/api/mockups/:id/comments/:commentId', async (req, res) => {
    try {
        const { commentId } = req.params;
        const { authorToken } = req.query;
        
        // Check if user is authenticated (designer)
        const token = req.cookies.auth_token;
        let isDesigner = false;
        if (token) {
            try {
                jwt.verify(token, JWT_SECRET);
                isDesigner = true;
            } catch (err) {}
        }

        // If not designer, check author token
        if (!isDesigner && authorToken) {
            const { data: existing } = await supabase
                .from('comments')
                .select('author_token')
                .eq('id', commentId)
                .single();

            if (existing && existing.author_token !== authorToken) {
                return res.status(403).json({ success: false, error: 'Not authorized to delete this comment' });
            }
        } else if (!isDesigner) {
            return res.status(403).json({ success: false, error: 'Not authorized' });
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

// Resolve comment - protected (designer action)
app.put('/api/mockups/:id/comments/:commentId/resolve', authenticateAPI, async (req, res) => {
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

app.delete('/api/mockups/:id/versions/:versionNum', authenticateAPI, async (req, res) => {
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

// ============ AI GENERATION API ============

// List available models
app.get('/api/ai/models', authenticateAPI, async (req, res) => {
    if (!GEMINI_API_KEY) {
        return res.json({ success: false, error: 'GEMINI_API_KEY not set' });
    }
    
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`);
        const data = await response.json();
        
        if (response.ok) {
            const models = data.models?.map(m => ({
                name: m.name,
                displayName: m.displayName,
                supportedMethods: m.supportedGenerationMethods
            })) || [];
            return res.json({ success: true, models });
        } else {
            return res.json({ success: false, error: data.error?.message, details: data });
        }
    } catch (error) {
        return res.json({ success: false, error: error.message });
    }
});

// Test endpoint to verify Gemini API connection
app.get('/api/ai/test', authenticateAPI, async (req, res) => {
    console.log('Testing Gemini API connection...');
    console.log('GEMINI_API_KEY present:', !!GEMINI_API_KEY);
    
    if (!GEMINI_API_KEY) {
        return res.json({ success: false, error: 'GEMINI_API_KEY not set in environment variables' });
    }
    
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: 'Say "Hello, API test successful!" and nothing else.' }]
                }]
            })
        });
        
        const status = response.status;
        const data = await response.json();
        
        if (response.ok) {
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            return res.json({ success: true, message: 'Gemini API connected', response: text });
        } else {
            return res.json({ success: false, status, error: data.error?.message || 'Unknown error', details: data });
        }
    } catch (error) {
        return res.json({ success: false, error: error.message });
    }
});

app.post('/api/ai/generate', authenticateAPI, async (req, res) => {
    console.log('AI Generate request received');
    console.log('GEMINI_API_KEY present:', !!GEMINI_API_KEY);
    console.log('GEMINI_API_KEY length:', GEMINI_API_KEY ? GEMINI_API_KEY.length : 0);
    
    if (!GEMINI_API_KEY) {
        return res.status(500).json({ success: false, error: 'Gemini API key not configured. Add GEMINI_API_KEY to Railway environment variables.' });
    }

    try {
        const { productInfo, fieldsToGenerate } = req.body;
        
        if (!productInfo) {
            return res.status(400).json({ success: false, error: 'Product info is required' });
        }
        
        console.log('Product info length:', productInfo.length);
        
        // Build the prompt based on what fields to generate
        const prompt = buildWalmartPrompt(productInfo, fieldsToGenerate);
        
        console.log('Calling Gemini API...');
        
        // Call Gemini API
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: prompt }]
                }],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 2048
                }
            })
        });

        console.log('Gemini response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Gemini API error status:', response.status);
            console.error('Gemini API error body:', errorText);
            
            // Parse error for better message
            try {
                const errorJson = JSON.parse(errorText);
                const errorMessage = errorJson.error?.message || 'AI generation failed';
                return res.status(500).json({ success: false, error: errorMessage });
            } catch (e) {
                return res.status(500).json({ success: false, error: `AI generation failed (${response.status})` });
            }
        }

        const data = await response.json();
        console.log('Gemini response received, candidates:', data.candidates?.length);
        
        const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!generatedText) {
            console.error('No text in response:', JSON.stringify(data));
            return res.status(500).json({ success: false, error: 'No content generated' });
        }

        console.log('Generated text length:', generatedText.length);

        // Parse the generated content
        const parsedContent = parseGeneratedContent(generatedText);
        
        if (!parsedContent) {
            console.error('Failed to parse generated content');
            return res.status(500).json({ success: false, error: 'Failed to parse AI response' });
        }
        
        console.log('Successfully parsed content');
        res.json({ success: true, generated: parsedContent });
    } catch (error) {
        console.error('AI generation error:', error.message);
        console.error('Full error:', error);
        res.status(500).json({ success: false, error: `AI generation failed: ${error.message}` });
    }
});

// Regenerate a specific field
app.post('/api/ai/regenerate-field', authenticateAPI, async (req, res) => {
    if (!GEMINI_API_KEY) {
        return res.status(500).json({ success: false, error: 'Gemini API key not configured' });
    }

    try {
        const { productInfo, field, currentValue } = req.body;
        
        const prompt = buildFieldRegeneratePrompt(productInfo, field, currentValue);
        
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: prompt }]
                }],
                generationConfig: {
                    temperature: 0.8,
                    maxOutputTokens: 1024
                }
            })
        });

        if (!response.ok) {
            return res.status(500).json({ success: false, error: 'AI generation failed' });
        }

        const data = await response.json();
        const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!generatedText) {
            return res.status(500).json({ success: false, error: 'No content generated' });
        }

        // Clean up the response
        const cleanedValue = generatedText.trim().replace(/^["']|["']$/g, '');
        
        res.json({ success: true, value: cleanedValue });
    } catch (error) {
        console.error('AI regeneration error:', error);
        res.status(500).json({ success: false, error: 'AI regeneration failed' });
    }
});

function buildWalmartPrompt(productInfo, fieldsToGenerate) {
    const allFields = !fieldsToGenerate || fieldsToGenerate.length === 0;
    
    return `You are an expert e-commerce copywriter specializing in Walmart product listings. Generate optimized product content based on the following information:

PRODUCT INFORMATION:
${productInfo}

Generate the following content for a Walmart Product Detail Page (PDP). The content should be:
- Clear, concise, and customer-focused
- Optimized for search (include relevant keywords naturally)
- Following Walmart's style guidelines
- Professional but approachable tone

Please respond in the following JSON format ONLY (no markdown, no code blocks, just valid JSON):

{
  "brand": "Brand name (2-3 words max)",
  "title": "Product title optimized for Walmart (50-75 characters, include key features)",
  "price": "Suggested price as a number only, e.g., 12.97",
  "packSize": "Pack size or quantity (e.g., '16 oz', '2 Pack', '100 Count')",
  "ingredients": "Key ingredients or materials if applicable, otherwise leave empty",
  "bullets": [
    "First key benefit or feature (start with action verb or key benefit)",
    "Second key benefit or feature",
    "Third key benefit or feature",
    "Fourth key benefit or feature (if applicable)"
  ],
  "detailsBullets": [
    "Additional product detail 1",
    "Additional product detail 2",
    "Additional product detail 3"
  ],
  "fullDescription": "2-3 sentence product description for the 'Product Details' section. Focus on benefits and use cases."
}

Remember: Return ONLY the JSON object, no additional text or formatting.`;
}

function buildFieldRegeneratePrompt(productInfo, field, currentValue) {
    const fieldDescriptions = {
        brand: 'a brand name (2-3 words max)',
        title: 'a Walmart product title (50-75 characters, optimized for search)',
        price: 'a competitive price (number only, e.g., 12.97)',
        packSize: 'a pack size or quantity (e.g., "16 oz", "2 Pack")',
        ingredients: 'a list of key ingredients or materials',
        bullets: '4 key feature bullet points (each starting with action verb or benefit)',
        detailsBullets: '3 additional product detail bullets',
        fullDescription: 'a 2-3 sentence product description focusing on benefits'
    };

    return `You are an expert e-commerce copywriter for Walmart. 

PRODUCT CONTEXT:
${productInfo}

CURRENT ${field.toUpperCase()}:
${currentValue}

Generate a NEW, DIFFERENT ${fieldDescriptions[field] || field}. Make it better than the current one.

${field === 'bullets' || field === 'detailsBullets' ? 
    'Return as a JSON array of strings, e.g., ["Point 1", "Point 2", "Point 3"]' : 
    'Return ONLY the new value, no quotes or explanation.'}`;
}

function parseGeneratedContent(text) {
    try {
        // Try to extract JSON from the response
        let jsonStr = text.trim();
        
        // Remove markdown code blocks if present
        jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '');
        
        // Find JSON object boundaries
        const startIdx = jsonStr.indexOf('{');
        const endIdx = jsonStr.lastIndexOf('}');
        
        if (startIdx !== -1 && endIdx !== -1) {
            jsonStr = jsonStr.substring(startIdx, endIdx + 1);
        }
        
        const parsed = JSON.parse(jsonStr);
        return parsed;
    } catch (e) {
        console.error('Failed to parse AI response:', e);
        console.error('Raw response:', text);
        return null;
    }
}

// Test image generation capabilities
app.get('/api/ai/test-image', authenticateAPI, async (req, res) => {
    console.log('Testing image generation capabilities...');
    
    if (!GEMINI_API_KEY) {
        return res.json({ success: false, error: 'GEMINI_API_KEY not set' });
    }
    
    const results = {
        imagen4: null,
        geminiImageGen: null,
        gemini2Flash: null
    };
    
    // Test Imagen 4
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                instances: [{
                    prompt: "A red apple on a white background"
                }],
                parameters: {
                    sampleCount: 1
                }
            })
        });
        const data = await response.json();
        results.imagen4 = { status: response.status, ok: response.ok, error: data.error?.message || null };
    } catch (e) {
        results.imagen4 = { error: e.message };
    }
    
    // Test Gemini image generation model
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: "Generate an image of a red apple on white background" }]
                }],
                generationConfig: {
                    responseModalities: ["image", "text"]
                }
            })
        });
        const data = await response.json();
        results.geminiImageGen = { 
            status: response.status, 
            ok: response.ok, 
            error: data.error?.message || null,
            hasImage: !!data.candidates?.[0]?.content?.parts?.find(p => p.inlineData)
        };
    } catch (e) {
        results.geminiImageGen = { error: e.message };
    }
    
    // Test standard Gemini 2.0 Flash with image output
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: "Describe a red apple" }]
                }]
            })
        });
        const data = await response.json();
        results.gemini2Flash = { 
            status: response.status, 
            ok: response.ok, 
            error: data.error?.message || null
        };
    } catch (e) {
        results.gemini2Flash = { error: e.message };
    }
    
    res.json({ success: true, results });
});

// Image generation endpoint
app.post('/api/ai/generate-image', authenticateAPI, async (req, res) => {
    console.log('Image generation request received');
    
    if (!GEMINI_API_KEY) {
        return res.status(500).json({ success: false, error: 'Gemini API key not configured' });
    }

    try {
        const { referenceImage, prompt } = req.body;
        
        if (!referenceImage) {
            return res.status(400).json({ success: false, error: 'Reference image is required' });
        }
        
        if (!prompt) {
            return res.status(400).json({ success: false, error: 'Prompt is required' });
        }
        
        // Extract base64 data from data URL
        const base64Match = referenceImage.match(/^data:image\/(\w+);base64,(.+)$/);
        if (!base64Match) {
            return res.status(400).json({ success: false, error: 'Invalid image format' });
        }
        
        const mimeType = `image/${base64Match[1]}`;
        const base64Data = base64Match[2];
        
        console.log('Calling Gemini image generation API...');
        console.log('Image mime type:', mimeType);
        console.log('Prompt length:', prompt.length);
        
        // Use Gemini 2.0 Flash with image generation capability
        // First, have it analyze the reference image and generate a new one based on the prompt
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        {
                            inlineData: {
                                mimeType: mimeType,
                                data: base64Data
                            }
                        },
                        {
                            text: `Look at this product image carefully. Now generate a NEW, DIFFERENT image of this same product with the following specifications: ${prompt}

Important: Generate a photorealistic product image. The product should look exactly like the reference but in a new setting/angle as described.`
                        }
                    ]
                }],
                generationConfig: {
                    responseModalities: ["image", "text"]
                }
            })
        });

        console.log('Gemini response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Gemini image gen error:', errorText);
            
            // Try Imagen 4 without reference image (just prompt-based)
            console.log('Trying Imagen 4 without reference...');
            
            // First, use Gemini to describe the product from the reference image
            const describeResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            {
                                inlineData: {
                                    mimeType: mimeType,
                                    data: base64Data
                                }
                            },
                            {
                                text: "Describe this product in detail for image generation. Include: product type, color, shape, size, materials, brand elements, and any distinctive features. Be very specific and detailed. Output only the description, nothing else."
                            }
                        ]
                    }]
                })
            });
            
            if (!describeResponse.ok) {
                return res.status(500).json({ success: false, error: 'Failed to analyze reference image' });
            }
            
            const describeData = await describeResponse.json();
            const productDescription = describeData.candidates?.[0]?.content?.parts?.[0]?.text || '';
            
            console.log('Product description:', productDescription.substring(0, 200));
            
            // Now use Imagen 4 with the detailed description
            const imagenResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${GEMINI_API_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    instances: [{
                        prompt: `Professional product photography: ${productDescription}. ${prompt}. High quality, commercial photography style, 8k resolution.`
                    }],
                    parameters: {
                        sampleCount: 1,
                        aspectRatio: "1:1",
                        personGeneration: "dont_allow"
                    }
                })
            });
            
            console.log('Imagen response status:', imagenResponse.status);
            
            if (!imagenResponse.ok) {
                const imagenError = await imagenResponse.text();
                console.error('Imagen error:', imagenError);
                return res.status(500).json({ success: false, error: 'Image generation failed. The AI models may not support this type of generation yet.' });
            }
            
            const imagenData = await imagenResponse.json();
            
            if (imagenData.predictions?.[0]?.bytesBase64Encoded) {
                const imageBase64 = `data:image/png;base64,${imagenData.predictions[0].bytesBase64Encoded}`;
                return res.json({ success: true, image: imageBase64 });
            }
            
            return res.status(500).json({ success: false, error: 'No image generated from Imagen' });
        }

        const data = await response.json();
        console.log('Gemini response received, checking for image...');
        
        // Look for image in response parts
        const parts = data.candidates?.[0]?.content?.parts || [];
        const imagePart = parts.find(p => p.inlineData);
        
        if (imagePart?.inlineData) {
            console.log('Image found in response');
            const imageBase64 = `data:${imagePart.inlineData.mimeType || 'image/png'};base64,${imagePart.inlineData.data}`;
            return res.json({ success: true, image: imageBase64 });
        }
        
        // Check if there's text explaining why no image
        const textPart = parts.find(p => p.text);
        if (textPart) {
            console.log('Response text:', textPart.text.substring(0, 200));
        }
        
        console.error('No image in response. Parts:', parts.map(p => Object.keys(p)));
        return res.status(500).json({ success: false, error: 'No image was generated. Try a different prompt.' });
        
    } catch (error) {
        console.error('Image generation error:', error.message);
        console.error('Full error:', error);
        res.status(500).json({ success: false, error: `Image generation failed: ${error.message}` });
    }
});

// ============ PUBLIC VIEWER ROUTE ============

// Viewer page - PUBLIC (clients can view mockups)
app.get('/mockup/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'viewer.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Connected to Supabase');
    console.log('Authentication enabled');
    console.log(`Gemini AI: ${GEMINI_API_KEY ? 'enabled' : 'not configured'}`);
});
