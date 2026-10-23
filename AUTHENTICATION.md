# Authentication Setup Guide

## Setup Steps

### 1. Backend Setup

1. **Create `.env` file in the `backend` folder** with the following content:
```
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_secret_key_here
PORT=3000
```

2. **Install backend dependencies**:
```bash
cd backend
npm install
```

3. **Create a user**:
```bash
npm run create-user
```
This creates a user with:
- Username: `Admin`
- Password: `admin123@`

You can modify the username and password in `backend/create-or-update-user.js` if needed.

4. **Start the backend server**:
```bash
npm start
```

### 2. Frontend Setup

The authentication is already configured with:
- Login page at `/login`
- Protected routes using `authGuard`
- HTTP interceptor to add auth token to requests
- Auto-logout after 2 minutes of inactivity

### 3. Login

1. Start the Angular app:
```bash
npm start
```

2. Navigate to `http://localhost:4200`
3. You'll be redirected to the login page
4. Login with:
   - Username: `Admin`
   - Password: `admin123@`

### 4. Features

- **Auto logout**: User is logged out after 2 minutes of inactivity
- **Token-based auth**: JWT tokens are used for authentication
- **Protected routes**: All routes except `/login` require authentication
- **Change password**: Available at `/change-password` (accessible from the app)

### 5. Troubleshooting

**Backend not connecting to MongoDB:**
- Verify your `MONGODB_URI` in `.env`
- Make sure MongoDB is running

**Login fails:**
- Check backend console for errors
- Verify user was created (run `npm run create-user` again)
- Check browser console for API errors

**Routes not protected:**
- Clear browser localStorage
- Refresh the page
