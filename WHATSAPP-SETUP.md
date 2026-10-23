# WhatsApp Messaging Integration

This document explains how to use the WhatsApp messaging feature in the ITB application.

## Overview

The WhatsApp integration uses `whatsapp-web.js` to send messages to contacts directly from the application. This feature allows you to:
- Connect your WhatsApp account via QR code
- Manage contacts with phone numbers
- Send individual or bulk messages
- Use pre-formatted message templates

## Setup Instructions

### 1. Backend Setup

The backend dependencies have been installed:
- `whatsapp-web.js` - WhatsApp Web API client
- `qrcode-terminal` - QR code display in terminal

### 2. Start the Backend Server

```bash
cd backend
npm start
```

The WhatsApp routes are available at: `http://localhost:3000/api/whatsapp/*`

### 3. Start the Frontend

```bash
npm start
```

## Using the WhatsApp Feature

### Step 1: Connect WhatsApp

1. Navigate to the **WhatsApp** tab in the application
2. Go to the **Connection** sub-tab
3. Click **Initialize WhatsApp**
4. Wait for the QR code to appear
5. Open WhatsApp on your phone:
   - Go to Settings > Linked Devices
   - Tap "Link a Device"
   - Scan the QR code displayed in the app
6. Once connected, the status will change to "Connected"

**Note**: The WhatsApp session is persisted locally, so you won't need to scan the QR code every time unless you disconnect or the session expires.

### Step 2: Add Contacts

1. Go to the **Contacts** tab
2. Enter the contact name
3. Enter the phone number:
   - Include country code (e.g., `1234567890` for a US number)
   - The system will automatically format it as `1234567890@c.us`
   - Or you can enter the full WhatsApp ID: `1234567890@c.us`
4. Click **Add Contact**

### Step 3: Send Messages

1. Go to the **Send Message** tab
2. Select one or more contacts from your contact list
3. Type your message or use a quick template:
   - **Greeting**: Simple hello message
   - **Race Results**: Template for race winners
   - **Betting Summary**: Template for betting reports
4. Click **Send Message**

**Formatting Tips**:
- Use `*text*` for **bold**
- Use `_text_` for _italic_
- Use `~text~` for ~~strikethrough~~

## API Endpoints

The following endpoints are available (all require authentication):

### Connection Management
- `GET /api/whatsapp/status` - Get current WhatsApp connection status
- `POST /api/whatsapp/initialize` - Initialize WhatsApp client
- `POST /api/whatsapp/disconnect` - Disconnect WhatsApp client

### Contact Management
- `GET /api/whatsapp/contacts` - Get all contacts
- `POST /api/whatsapp/contacts` - Add a new contact
- `DELETE /api/whatsapp/contacts/:id` - Delete a contact

### Messaging
- `POST /api/whatsapp/send-message` - Send message to single contact
- `POST /api/whatsapp/send-bulk` - Send message to multiple contacts
- `POST /api/whatsapp/send-report` - Send formatted betting report

## Example: Send Formatted Report

To send a formatted betting report programmatically:

```typescript
const reportData = {
  title: 'Race Day Results',
  meeting: 'Churchill Downs',
  date: '2026-05-19',
  races: [
    { winner: 'Thunder Strike', totalBets: '$5,000', totalPayout: '$15,000' },
    { winner: 'Lightning Bolt', totalBets: '$3,500', totalPayout: '$8,500' }
  ],
  summary: 'Total Revenue: $8,500\nTotal Payout: $23,500',
  footer: 'Thank you for your business!'
};

this.http.post(`${this.apiUrl}/api/whatsapp/send-report`, {
  contactId: 'contact-id-here',
  reportData
}).subscribe(...);
```

## Troubleshooting

### QR Code Not Appearing
- Check that the backend is running
- Check the browser console for errors
- Try clicking "Refresh Status"

### Authentication Failed
- The QR code may have expired
- Click "Initialize WhatsApp" again to generate a new QR code
- Make sure you scan within the time limit

### Message Not Sending
- Verify WhatsApp status is "Connected"
- Check that the phone number format is correct
- Ensure the number is registered on WhatsApp
- Check backend logs for error messages

### Session Expired
- You may need to scan the QR code again
- Sessions typically last for several weeks but can expire

## Security Notes

- WhatsApp sessions are stored locally on the server in `.wwebjs_auth` directory
- Only authenticated users can access WhatsApp endpoints
- Contacts are stored in memory (consider moving to MongoDB for persistence)
- Messages are sent through your WhatsApp account, so they appear as coming from you

## Future Enhancements

Possible improvements:
- Store contacts in MongoDB for persistence
- Add message scheduling
- Add support for sending images/documents
- Integrate with reports to auto-send race results
- Add message templates management
- Add message history/logs
