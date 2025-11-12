# Quick Start Guide

## ✅ Backend Server is Ready!

I've created two server versions for you:

### 1. **server-simple.js** (Recommended - No MongoDB Required)
- Uses JSON file storage
- Works immediately
- Perfect for development
- Data saved in `backend/data/appdata.json`

### 2. **server.js** (MongoDB Version)
- Requires MongoDB installation
- Better for production
- Supports advanced queries

## 🚀 How to Run the Server

### Option 1: Using the Simple Server (File-based)

1. **Open a NEW PowerShell terminal**
2. **Navigate to backend folder:**
   ```powershell
   cd C:\temp\windows\Games\backend
   ```

3. **Start the server:**
   ```powershell
   node server-simple.js
   ```
   
   **OR use npm:**
   ```powershell
   npm start
   ```

4. **Server should show:**
   ```
   ✅ Data directory ready
   🚀 Server is running on http://localhost:3000
   💾 Using file-based storage
   ```

5. **Test it works:**
   Open browser and go to: `http://localhost:3000/api/health`
   
   Should see: `{"status":"OK","message":"Server is running"}`

### Option 2: Using MongoDB Server (Optional)

1. **Install MongoDB:**
   - Download: https://www.mongodb.com/try/download/community
   - Install as Windows Service
   - Default port: 27017

2. **Start MongoDB service:**
   ```powershell
   net start MongoDB
   ```

3. **Run MongoDB server:**
   ```powershell
   node server.js
   ```
   
   **OR:**
   ```powershell
   npm run start:mongo
   ```

## 📊 API Endpoints

All endpoints work on: `http://localhost:3000`

### Health Check
```
GET /api/health
```

### Get Current Data
```
GET /api/appdata
```

### Save Data
```
POST /api/appdata
Content-Type: application/json

{
  "marketType": 0,
  "numEvents": 3,
  "events": [...],
  "eventData": {...}
}
```

### Get Specific Race
```
GET /api/event/1
```

### Clear All Data
```
DELETE /api/appdata/clear/all
```

## 🧪 Test the API

### PowerShell Test:
```powershell
# Health check
Invoke-RestMethod -Uri http://localhost:3000/api/health -Method Get

# Get data
Invoke-RestMethod -Uri http://localhost:3000/api/appdata -Method Get
```

### Browser Test:
Open: `http://localhost:3000/api/health`

## 🔗 Connect Angular to Backend

The Angular app already uses localStorage. To connect it to the backend:

### Option A: Auto-sync with Backend (Recommended)

Update `src/app/shared/market.service.ts` to add HTTP calls alongside localStorage.

I can help you implement this if you'd like!

### Option B: Manual Sync

Add a "Save to Server" button that calls the API.

## 📁 File Structure

```
backend/
├── server.js              # MongoDB version
├── server-simple.js       # File-based version (active)
├── package.json           # Dependencies
├── README.md             # Full documentation
├── QUICKSTART.md         # This file
├── .env.example          # Config template
├── .gitignore
└── data/
    └── appdata.json      # Your data (auto-created)
```

## 🐛 Troubleshooting

### Server won't start
```powershell
# Check if port 3000 is in use
netstat -ano | findstr :3000

# If in use, kill the process
taskkill /PID <process_id> /F

# Or change port in server-simple.js (line: const PORT = 3000)
```

### Can't access from Angular
- Make sure both servers are running:
  - Angular: `http://localhost:4200` 
  - Backend: `http://localhost:3000`
- CORS is already enabled in the server

### Data not saving
- Check the `backend/data/appdata.json` file exists
- Check server console for error messages
- Verify POST request has correct JSON format

## 📝 Next Steps

1. ✅ Backend server created
2. ✅ Dependencies installed
3. ⏳ **Start the server** → `npm start`
4. ⏳ Test API endpoints
5. ⏳ Connect Angular app to backend

## 💡 Tips

- Keep the backend server running in a separate terminal
- Data persists in `data/appdata.json` file
- You can manually edit the JSON file if needed
- The server auto-saves on every API call

## Need Help?

Check the full `README.md` for detailed documentation!
