# Games Backend Server

Node.js/Express backend server with MongoDB for the Games application.

## Features

- RESTful API for race/event data management
- MongoDB database integration
- CORS enabled for Angular frontend
- Complete CRUD operations
- Historical data tracking
- Event-specific queries

## Prerequisites

1. **Node.js** (v14 or higher)
2. **MongoDB** (local installation or MongoDB Atlas account)

### Install MongoDB (Windows)

**Option 1: MongoDB Community Server (Local)**
- Download from: https://www.mongodb.com/try/download/community
- Install and run as a Windows service
- Default connection: `mongodb://localhost:27017`

**Option 2: MongoDB Atlas (Cloud)**
- Sign up at: https://www.mongodb.com/cloud/atlas
- Create a free cluster
- Get your connection string
- Update `.env` file with your connection string

## Installation

1. Navigate to the backend folder:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file (copy from `.env.example`):
```bash
copy .env.example .env
```

4. Update `.env` with your MongoDB connection string if needed

## Running the Server

**Development mode (with auto-restart):**
```bash
npm run dev
```

**Production mode:**
```bash
npm start
```

Or simply:
```bash
node server
```

The server will start on `http://localhost:3000`

## API Endpoints

### Health Check
- `GET /api/health` - Check if server is running

### App Data
- `GET /api/appdata` - Get latest app data
- `GET /api/appdata/:id` - Get app data by ID
- `POST /api/appdata` - Save new app data
- `PUT /api/appdata/:id` - Update app data
- `DELETE /api/appdata/:id` - Delete app data by ID
- `GET /api/appdata/history/all?limit=10` - Get historical data
- `DELETE /api/appdata/clear/all` - Clear all data

### Event Data
- `GET /api/event/:eventId` - Get specific event/race data

## API Usage Examples

### Save Race Data
```bash
POST http://localhost:3000/api/appdata
Content-Type: application/json

{
  "marketType": 0,
  "numEvents": 3,
  "events": [
    { "id": 1, "name": "1" },
    { "id": 2, "name": "2" },
    { "id": 3, "name": "3" }
  ],
  "selectedEventId": 1,
  "eventData": {
    "1": {
      "marketName": "Race 1",
      "numMarketList": 5,
      "marketLists": [
        { "id": 1, "name": "Horse 1", "odds100": 0, "special": 0, "rule4": 0, "rule4Deduction": 0 },
        { "id": 2, "name": "Horse 2", "odds100": 0, "special": 0, "rule4": 0, "rule4Deduction": 0 }
      ]
    }
  }
}
```

### Get Latest Data
```bash
GET http://localhost:3000/api/appdata
```

### Get Specific Event
```bash
GET http://localhost:3000/api/event/1
```

## Database Schema

### AppData Collection
```javascript
{
  marketType: Number,
  numEvents: Number,
  events: [{ id: Number, name: String }],
  selectedEventId: Number,
  eventData: [
    {
      eventId: Number,
      marketName: String,
      numMarketList: Number,
      marketLists: [
        {
          id: Number,
          name: String,
          odds100: Number,
          special: Number,
          rule4: Number,
          rule4Deduction: Number
        }
      ]
    }
  ],
  createdAt: Date,
  updatedAt: Date
}
```

## Integration with Angular Frontend

To connect your Angular app to this backend:

1. Install Angular HttpClient (already included in Angular)

2. Update `MarketService` to use HTTP instead of localStorage:
```typescript
import { HttpClient } from '@angular/common/http';

constructor(private http: HttpClient) {}

// Save data
saveToServer() {
  return this.http.post('http://localhost:3000/api/appdata', this.appData);
}

// Load data
loadFromServer() {
  return this.http.get('http://localhost:3000/api/appdata');
}
```

3. Make sure both servers are running:
   - Angular: `npm start` (port 4200)
   - Backend: `node server` (port 3000)

## Troubleshooting

### MongoDB Connection Issues
- Ensure MongoDB is running: `net start MongoDB` (Windows)
- Check connection string in `.env` file
- Verify firewall settings

### Port Already in Use
- Change PORT in `.env` file
- Or kill the process using port 3000:
```bash
netstat -ano | findstr :3000
taskkill /PID <process_id> /F
```

### CORS Errors
- Server already has CORS enabled
- If issues persist, check browser console for specific errors

## Development Tools

### Test API with PowerShell
```powershell
# Health check
Invoke-RestMethod -Uri http://localhost:3000/api/health -Method Get

# Get data
Invoke-RestMethod -Uri http://localhost:3000/api/appdata -Method Get

# Save data
$body = @{
  marketType = 0
  numEvents = 3
  events = @(@{ id=1; name="1" })
} | ConvertTo-Json

Invoke-RestMethod -Uri http://localhost:3000/api/appdata -Method Post -Body $body -ContentType "application/json"
```

### Test API with curl
```bash
# Health check
curl http://localhost:3000/api/health

# Get data
curl http://localhost:3000/api/appdata

# Save data
curl -X POST http://localhost:3000/api/appdata -H "Content-Type: application/json" -d "{\"marketType\":0,\"numEvents\":3}"
```

## Next Steps

1. Install and start MongoDB
2. Install backend dependencies: `npm install`
3. Start the server: `node server`
4. Test the API: `http://localhost:3000/api/health`
5. Integrate with Angular frontend

## License

ISC
