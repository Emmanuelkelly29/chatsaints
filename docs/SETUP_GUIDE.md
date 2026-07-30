# LDS YSA Connect — Complete Setup Guide

## What You Need to Install on Your Computer

### Step 1 — Install Node.js
Node.js runs the backend server.

1. Go to https://nodejs.org
2. Download the "LTS" version (the green button)
3. Run the installer — click Next through all steps
4. To confirm it worked, open a terminal and type:
   ```
   node --version
   ```
   You should see something like: v20.0.0

---

### Step 2 — Install PostgreSQL (the main database)
1. Go to https://www.postgresql.org/download/
2. Choose your operating system (Windows / Mac / Linux)
3. Download and run the installer
4. During install, set a password — WRITE THIS DOWN, you will need it
5. Leave the port as 5432
6. After install, open "pgAdmin" (it installs alongside PostgreSQL)
7. In pgAdmin, right-click "Databases" → Create → Database
8. Name it: `lds_ysa_db`
9. Click Save

---

### Step 3 — Install Redis (for online presence and caching)

**On Windows:**
1. Go to https://github.com/microsoftarchive/redis/releases
2. Download `Redis-x64-3.0.504.msi`
3. Run the installer — tick "Add to PATH"
4. Redis will run automatically as a Windows service

**On Mac:**
```
brew install redis
brew services start redis
```

**On Linux (Ubuntu):**
```
sudo apt install redis-server
sudo systemctl start redis
```

---

### Step 4 — Install Flutter (for the mobile app)
1. Go to https://docs.flutter.dev/get-started/install
2. Choose your operating system
3. Follow the installation steps exactly
4. After installing, open a terminal and run:
   ```
   flutter doctor
   ```
   This tells you what else you need. Follow any instructions it gives.

**For Android development:**
- Download Android Studio from https://developer.android.com/studio
- Open Android Studio → SDK Manager → install Android SDK

**For iOS development (Mac only):**
- Install Xcode from the Mac App Store
- Run: `sudo xcode-select --install`

---

### Step 5 — Install Git (for version control)
1. Go to https://git-scm.com/downloads
2. Download and install for your OS
3. Confirm: `git --version`

---

## Setting Up the Project

### Step 6 — Configure the Backend

1. Open a terminal and navigate to the backend folder:
   ```
   cd lds-ysa-app/backend
   ```

2. Copy the example environment file:
   ```
   cp .env.example .env
   ```

3. Open `.env` in any text editor (Notepad, VSCode, etc.)
   Fill in your actual values:
   ```
   DB_PASSWORD=the_password_you_set_during_postgresql_install
   JWT_SECRET=make_up_any_long_random_string_at_least_64_characters
   ```

4. Configure SMTP for OTP email delivery (required for registration/login OTP):

   Important:
   - Users can register with any email provider/domain (Gmail, Outlook, Yahoo, Proton, custom business domains).
   - Your app uses one outbound SMTP provider/account to send OTPs to all recipient domains.

   Option A (recommended): SMTP URL
   ```
   SMTP_URL=smtp://username:password@mail.yourprovider.com:587
   # or SSL/TLS
   SMTP_URL=smtps://username:password@mail.yourprovider.com:465
   MAIL_FROM="ChatSaints" <no-reply@yourdomain.com>
   ```

   Option B: Host/port/user/pass variables
   ```
   SMTP_HOST=mail.yourprovider.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=your-smtp-username
   SMTP_PASS=your-smtp-password
   MAIL_FROM="ChatSaints" <no-reply@yourdomain.com>
   ```

   Provider examples:
   - Gmail SMTP: host `smtp.gmail.com`, port `587`, secure `false`, user = Gmail address, pass = App Password
   - Outlook/Office365 SMTP: host `smtp.office365.com`, port `587`, secure `false`
   - Custom domain mailbox: use your hosting provider SMTP host/credentials (Zoho, cPanel, Workspace, etc.)

5. Install backend packages (only needed once):
   ```
   npm install
   ```

---

### Step 7 — Create the Database Tables

1. Open pgAdmin
2. Click on your `lds_ysa_db` database
3. Click the "Query Tool" button (looks like a play button)
4. Open the file: `lds-ysa-app/database/migrations/001_schema.sql`
5. Copy ALL the contents and paste into the Query Tool
6. Click the Run button (▶)
7. You should see "Query returned successfully"

8. Now do the same for the seed data:
   Open: `lds-ysa-app/database/seeds/001_seed.sql`
   Copy → Paste → Run

   This loads the initial areas, stakes, missions, and scriptures.

---

### Step 8 — Start the Backend Server

In your terminal (inside the `backend` folder):

```
npm run dev
```

You should see:
```
╔══════════════════════════════════════════╗
║       LDS YSA Connect — Backend          ║
║  HTTP  →  http://localhost:4000          ║
║  WS    →  ws://localhost:4000/ws         ║
╚══════════════════════════════════════════╝
```

The server is now running. Keep this terminal window open.

To test it is working, open your browser and go to:
```
http://localhost:4000/health
```
You should see: `{"status":"ok","app":"LDS YSA Connect"}`

---

### Step 9 — Set Up the Flutter App

1. Open a NEW terminal window
2. Navigate to the frontend folder:
   ```
   cd lds-ysa-app/frontend
   ```

3. Install Flutter packages:
   ```
   flutter pub get
   ```

4. Open the file `lib/utils/constants.dart`
   If you are running on a real Android phone (not emulator), change:
   ```dart
   static const String baseUrl = 'http://localhost:4000';
   ```
   To your computer's local IP address, for example:
   ```dart
   static const String baseUrl = 'http://192.168.1.5:4000';
   ```
   (Find your IP: on Windows run `ipconfig`, on Mac/Linux run `ifconfig`)

5. Connect your phone via USB and enable Developer Mode, OR start an emulator in Android Studio

6. Run the app:
   ```
   flutter run
   ```

---

## How to Use the App (First Time)

### Creating the First Admin Account

Since leader accounts need approval from existing leaders, you need to manually approve the very first leader in the database.

1. Register normally in the app with role = "Stake Presidency"
2. Open pgAdmin → Query Tool
3. Run this query (replace the email/phone with yours):
   ```sql
   UPDATE users SET is_approved = true WHERE phone_number = '+234XXXXXXXXXX';
   ```
4. Log out and log back in — you now have full leader access

### Registering YSA Members
- Download the app
- Register with phone number
- Select "YSA Member" as role
- Select your stake
- You are automatically added to the stake pool (pending YSA Rep approval)

### Approving a YSA Rep or Bishop
1. Log in as a Stake Presidency member
2. Go to the Leaders tab
3. Under "Approvals", you will see pending applications
4. Tap Approve

---

## Running in Production (When Ready to Launch Globally)

When you are ready to launch the app for all YSA worldwide, you will need:

### A Cloud Server
Recommended: **DigitalOcean** or **AWS EC2**
- Minimum: 2 CPU, 4GB RAM server
- Ubuntu 22.04

### Steps for Production
1. Copy the project to the server via Git
2. Install Node.js, PostgreSQL, Redis on the server
3. Update `.env` with production values and your server's domain
4. Install PM2 to keep the server running:
   ```
   npm install -g pm2
   pm2 start server.js --name lds-ysa-backend
   pm2 save
   ```
5. Set up Nginx as a reverse proxy (so the app is accessible via a domain name)
6. Get a free SSL certificate from Let's Encrypt:
   ```
   sudo certbot --nginx
   ```
7. Build the Flutter app for release:
   ```
   flutter build apk --release          # Android
   flutter build ios --release          # iOS (requires Mac + Apple Developer account)
   ```
8. Submit to Google Play Store and Apple App Store

### Firebase Push Notifications Setup
1. Go to https://console.firebase.google.com
2. Create a new project called "lds-ysa-connect"
3. Add Android app → download `google-services.json`
4. Add iOS app → download `GoogleService-Info.plist`
5. Copy your FCM Server Key into `.env` as `FCM_SERVER_KEY`

---

## Project File Map

```
lds-ysa-app/
│
├── backend/                        ← Node.js API server
│   ├── server.js                   ← Entry point — run this
│   ├── .env.example                ← Copy to .env and fill in
│   ├── src/
│   │   ├── app.js                  ← Express app, all routes registered
│   │   ├── config/
│   │   │   ├── database.js         ← PostgreSQL connection
│   │   │   └── redis.js            ← Redis connection
│   │   ├── middleware/
│   │   │   └── auth.js             ← JWT authentication
│   │   ├── controllers/
│   │   │   ├── authController.js   ← Register, login
│   │   │   ├── userController.js   ← Profiles, search, stake pool
│   │   │   ├── conversationController.js ← Chats, messages, pinning
│   │   │   ├── missionaryController.js   ← Mission mode, presidents
│   │   │   ├── scriptureController.js    ← Rotating scripture feed
│   │   │   └── leaderController.js       ← Approval queue
│   │   ├── routes/                 ← HTTP route definitions
│   │   ├── websocket/
│   │   │   └── wsServer.js         ← Real-time messaging engine
│   │   └── utils/
│   │       └── accessControl.js    ← Hierarchy visibility rules
│
├── frontend/                       ← Flutter mobile app
│   ├── pubspec.yaml                ← Flutter dependencies
│   ├── lib/
│   │   ├── main.dart               ← App entry point
│   │   ├── theme/app_theme.dart    ← Colours and styles
│   │   ├── utils/constants.dart    ← Server URL config
│   │   ├── models/                 ← Data structures
│   │   │   ├── user_model.dart
│   │   │   ├── message_model.dart
│   │   │   └── conversation_model.dart
│   │   ├── services/               ← API and WebSocket clients
│   │   │   ├── api_service.dart
│   │   │   ├── auth_service.dart
│   │   │   └── websocket_service.dart
│   │   └── screens/                ← All app screens
│   │       ├── auth/               ← Login, Register
│   │       ├── home/               ← Home with scripture banner
│   │       ├── chat/               ← Conversations list, Chat room, Search
│   │       ├── leaders/            ← Approval queue, stake pool
│   │       ├── missionary/         ← Mission members, mode banner
│   │       └── profile/            ← User profile, sign out
│
└── database/
    ├── migrations/001_schema.sql   ← All tables — run this first
    └── seeds/001_seed.sql          ← Areas, stakes, scriptures
```

---

## API Reference (for developers)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/register | Create account |
| POST | /api/auth/login | Sign in |
| GET | /api/users/me | My profile + feature flags |
| GET | /api/users/search?q= | Search people (hierarchy-gated) |
| GET | /api/users/stake-pool | Browse approved YSA contacts |
| GET | /api/conversations | List my conversations |
| POST | /api/conversations | Create 1-on-1 or group |
| GET | /api/conversations/:id/messages | Get messages |
| POST | /api/conversations/:id/pin | Pin a chat (max 3) |
| GET | /api/scriptures/current | Current rotating scripture |
| GET | /api/leaders/approvals | Pending leader approvals |
| POST | /api/leaders/approvals/:id/approve | Approve a leader |
| POST | /api/missionary/activate | Activate missionary mode |
| POST | /api/missionary/deactivate | Return from mission |
| GET | /api/missionary/presidents | All mission presidents |

### WebSocket Events (real-time)

| Send | Description |
|------|-------------|
| `send_message` | Send a chat message |
| `typing` | Notify others you are typing |
| `mark_read` | Mark a message as read |
| `initiate_call` | Start a voice or video call |
| `end_call` | End an ongoing call |
| `ping` | Heartbeat (sent every 30s) |

| Receive | Description |
|---------|-------------|
| `new_message` | New message arrived |
| `user_typing` | Someone is typing |
| `message_read` | Your message was read |
| `incoming_call` | Someone is calling |
| `call_ended` | Call has ended |
| `connected` | WebSocket connected |
