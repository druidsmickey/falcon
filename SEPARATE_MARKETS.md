# Separate Local and International Data Implementation

## ✅ What's Been Implemented

Your application now maintains **completely separate datasets** for Local and International markets!

## 🎯 How It Works

### Frontend (Angular)

1. **Separate localStorage Keys:**
   - Local data: `gamesAppData_Local`
   - International data: `gamesAppData_International`

2. **Automatic Data Switching:**
   - When you click "Local" button → Loads Local data
   - When you click "International" button → Loads International data
   - All changes save to the correct dataset

3. **Visual Indicators:**
   - Toolbar shows: "Games - Local" or "Games - International"
   - Active market button has yellow border
   - Data indicator shows: "X races (Local)" or "X races (International)"

### Backend (Node.js)

1. **Separate JSON Files:**
   - Local data: `backend/data/appdata-local.json`
   - International data: `backend/data/appdata-international.json`

2. **Market-Specific API:**
   - GET `/api/appdata?marketType=0` → Returns Local data
   - GET `/api/appdata?marketType=1` → Returns International data
   - POST/PUT automatically saves to correct file based on `marketType`

## 🚀 Usage Example

### Scenario 1: Working with Local Races

1. Click **Local** button (toolbar turns black)
2. Enter 5 races
3. Add horse names
4. All data saves to Local storage

### Scenario 2: Switch to International

1. Click **International** button (toolbar turns pink)
2. See empty form (separate dataset)
3. Enter 3 races
4. Add different horse names
5. All data saves to International storage

### Scenario 3: Switch Back to Local

1. Click **Local** button
2. Your 5 Local races with all data are still there!
3. Completely independent from International data

## 📊 New UI Features

### Toolbar Enhancements:
- **Market Name Display:** "Games - Local" or "Games - International"
- **Active Market Indicator:** Yellow border on active button
- **Data Counter:** Shows race count + market type
- **Clear Current Market:** Clears only the active market
- **Clear All Markets:** Clears both Local AND International data

### Buttons:
```
[Local]  [Inter]  [Params]  [Events]  |  3 races (Local)  [Clear Local]  [Clear All Markets]
   ↑       ↑
  Black   Pink
  Active  Inactive
```

## 🔄 Data Flow

```
User clicks "Local"
    ↓
MarketService.setMarketType(0)
    ↓
Load data from: localStorage['gamesAppData_Local']
    ↓
EventsComponent receives Local data
    ↓
User makes changes
    ↓
Save to: localStorage['gamesAppData_Local']
```

```
User clicks "International"
    ↓
MarketService.setMarketType(1)
    ↓
Load data from: localStorage['gamesAppData_International']
    ↓
EventsComponent receives International data
    ↓
User makes changes
    ↓
Save to: localStorage['gamesAppData_International']
```

## 💾 Storage Structure

### Browser localStorage:
```javascript
{
  "marketType": 0,  // Current market type
  "gamesAppData_Local": {
    "numEvents": 5,
    "events": [...],
    "eventData": {...}
  },
  "gamesAppData_International": {
    "numEvents": 3,
    "events": [...],
    "eventData": {...}
  }
}
```

### Backend Files:
```
backend/data/
├── appdata-local.json          # Local market data
└── appdata-international.json  # International market data
```

## 🎨 Visual Changes

### Toolbar Color Coding:
- **Local Mode:** Black toolbar
- **International Mode:** Pink toolbar

### Active Market Indicator:
- **Active Button:** Yellow border + highlighted background
- **Inactive Button:** Normal appearance

### Data Display:
- Shows: "3 races (Local)" or "5 races (International)"
- Clear button: "Clear Local" or "Clear International"

## 🧪 Testing Steps

1. **Start with Local:**
   ```
   - Click Local button
   - Add 3 races with horse names
   - Note: toolbar is black
   ```

2. **Switch to International:**
   ```
   - Click International button
   - See empty form (expected!)
   - Add 5 races with different horse names
   - Note: toolbar is pink
   ```

3. **Switch back to Local:**
   ```
   - Click Local button
   - Your 3 Local races are still there!
   ```

4. **Refresh browser:**
   ```
   - Last used market type loads automatically
   - All data persists correctly
   ```

5. **Test Clear Functions:**
   ```
   - "Clear Local" → Only clears Local data
   - "Clear International" → Only clears International data
   - "Clear All Markets" → Clears BOTH datasets
   ```

## 📁 Modified Files

### Frontend:
- ✅ `src/app/shared/market.service.ts` - Separate storage keys & data management
- ✅ `src/app/events/events.component.ts` - Market type switch handling
- ✅ `src/app/app.component.ts` - Clear functions for each market
- ✅ `src/app/app.component.html` - Enhanced toolbar UI
- ✅ `src/app/app.component.css` - Active market styling

### Backend:
- ✅ `backend/server-simple.js` - Separate JSON files per market type
- ✅ API endpoints support marketType parameter

## 🎯 Key Features

✅ **Complete Data Separation:** Local and International never mix
✅ **Automatic Switching:** Data loads instantly when changing markets
✅ **Visual Feedback:** Clear indicators of active market
✅ **Persistent Storage:** All data survives browser refresh
✅ **Independent Operations:** Each market can have different numbers of races
✅ **Selective Clearing:** Clear one market or both
✅ **Backend Support:** Server maintains separate files

## 💡 Usage Tips

1. **Always check toolbar** to see which market you're working in
2. **Look for yellow border** on the active market button
3. **Data indicator** shows current market in parentheses
4. **Clear buttons** are market-aware and confirm before deleting
5. **Switching is instant** - no delay or loading screens

## 🔮 What Happens When...

### You enter races in Local mode:
- Saves to `gamesAppData_Local`
- Displayed when Local button is active
- Independent from International data

### You switch to International:
- Loads from `gamesAppData_International`
- Shows International races (may be empty initially)
- Local data remains untouched in storage

### You refresh the browser:
- Last used market type loads automatically
- All race data for that market displays
- No data loss

### You clear Local data:
- Only Local races are deleted
- International races remain intact
- Can still switch to International and see its data

### You clear all markets:
- Both Local AND International data deleted
- Fresh start for both markets
- Requires confirmation

## 🎉 Try It Out!

The application is now running with separate market support. Try:

1. Create Local races
2. Switch to International and create different races
3. Switch back and forth - data persists!
4. Refresh browser - everything stays
5. Use different number of races in each market
6. Clear one market while keeping the other

Your data is now truly separate for Local and International operations!
