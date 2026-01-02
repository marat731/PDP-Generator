# Walmart Product Mockup Generator

A professional web-based tool for creating and sharing Walmart.com product detail page mockups.

## 🚀 Deploy to Railway (5 minutes)

### Step 1: Prepare Your Code

1. Create a GitHub repository
2. Upload all files from this folder
3. Push to GitHub

### Step 2: Deploy on Railway

1. Go to https://railway.app
2. Sign up with your GitHub account
3. Click "New Project" → "Deploy from GitHub repo"
4. Select your repository
5. Railway auto-detects Node.js and deploys
6. Get your URL (e.g., `your-app.railway.app`)

### Step 3: Start Using

Visit your Railway URL and start creating mockups!

## ✨ Features

- **Live Editing** - Real-time preview
- **Drag & Drop Images** - Upload and reorder easily
- **Shareable URLs** - Permanent links for clients
- **Password Protection** - Optional security
- **View Tracking** - See client engagement
- **SQLite Storage** - All mockups saved permanently

## 💻 Local Development

```bash
npm install
npm start
# Visit http://localhost:3000
```

## 📖 How to Use

1. **Create Mockup**: Upload images, fill in product details
2. **Set Password** (optional): Add security to mockup
3. **Save & Share**: Get shareable URL
4. **Send to Client**: Share URL (and password if set)

## 🗂️ Project Structure

```
├── server.js          # Backend API
├── package.json       # Dependencies
├── railway.json       # Railway config
└── public/
    ├── index.html     # Editor
    ├── viewer.html    # Client view
    ├── styles.css     # Styles
    └── app.js         # Logic
```

## 🔧 Environment Variables

Railway automatically sets:
- `PORT` - Server port

Optional:
- `DATABASE_PATH` - SQLite file location

## 📝 API Endpoints

- `POST /api/mockups` - Create mockup
- `GET /api/mockups/:id` - Get mockup
- `PUT /api/mockups/:id` - Update mockup
- `DELETE /api/mockups/:id` - Delete mockup

## 🐛 Troubleshooting

**Railway deploy fails:**
- Check Railway logs
- Verify Node.js version in package.json
- Ensure all files are committed

**Local port in use:**
```bash
lsof -ti:3000 | xargs kill -9
```

## 📄 License

MIT - Free to use and modify
