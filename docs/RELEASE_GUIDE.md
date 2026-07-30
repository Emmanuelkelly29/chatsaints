# LDS YSA Connect — App Store & Play Store Release Guide

## Before You Release

### 1. Set Up Firebase for Push Notifications

**Step 1 — Create a Firebase project**
1. Go to https://console.firebase.google.com
2. Click "Add project" → name it "lds-ysa-connect"
3. Disable Google Analytics (not needed)

**Step 2 — Add Android app**
1. Click the Android icon
2. Package name: `com.ldschurch.ysa.connect`
3. Download `google-services.json`
4. Place it in: `frontend/android/app/google-services.json`

**Step 3 — Add iOS app**
1. Click the iOS/Apple icon
2. Bundle ID: `com.ldschurch.ysa.connect`
3. Download `GoogleService-Info.plist`
4. Open Xcode → drag the file into `Runner/` folder

**Step 4 — Get FCM Server Key**
1. In Firebase Console → Project Settings → Cloud Messaging
2. Copy the "Server key"
3. Paste it into your backend `.env` as `FCM_SERVER_KEY=...`

**Step 5 — Enable FCM in Flutter**
Uncomment this line in `lib/main.dart`:
```dart
// await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
```
Then run:
```
cd frontend
flutter pub add firebase_core firebase_messaging
flutterfire configure
```

---

### 2. Android Release Build

**Step 1 — Create a signing keystore (do this once)**
```bash
keytool -genkey -v \
  -keystore ~/lds-ysa-release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias lds-ysa-key
```
You will be asked for a password — WRITE IT DOWN.

**Step 2 — Configure signing in Flutter**
Create the file `frontend/android/key.properties`:
```properties
storePassword=YOUR_KEYSTORE_PASSWORD
keyPassword=YOUR_KEY_PASSWORD
keyAlias=lds-ysa-key
storeFile=/Users/yourname/lds-ysa-release.jks
```

Edit `frontend/android/app/build.gradle` and add before `android {`:
```gradle
def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file('key.properties')
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}
```

And in `buildTypes`:
```gradle
release {
    signingConfig signingConfigs.release
    minifyEnabled true
    shrinkResources true
}
signingConfigs {
    release {
        keyAlias keystoreProperties['keyAlias']
        keyPassword keystoreProperties['keyPassword']
        storeFile file(keystoreProperties['storeFile'])
        storePassword keystoreProperties['storePassword']
    }
}
```

**Step 3 — Build the APK / App Bundle**
```bash
cd frontend

# App Bundle (recommended for Play Store — smaller download)
flutter build appbundle --release

# APK (for direct distribution / testing)
flutter build apk --release --split-per-abi
```

Output files:
- App Bundle: `build/app/outputs/bundle/release/app-release.aab`
- APK: `build/app/outputs/flutter-apk/app-arm64-v8a-release.apk`

**Step 4 — Upload to Google Play Store**
1. Go to https://play.google.com/console
2. Create a developer account ($25 one-time fee)
3. Create new app → fill in details
4. Go to "Release" → "Production" → Upload your `.aab` file
5. Fill in the store listing (description, screenshots, privacy policy)
6. Submit for review (takes 1–3 days for the first release)

---

### 3. iOS Release Build (Mac only)

**Step 1 — Apple Developer Account**
1. Go to https://developer.apple.com
2. Enroll in the Apple Developer Program ($99/year)

**Step 2 — Configure in Xcode**
1. Open `frontend/ios/Runner.xcworkspace` in Xcode
2. Select the `Runner` target
3. Set Bundle Identifier: `com.ldschurch.ysa.connect`
4. Select your Team (your Apple Developer account)
5. Let Xcode manage signing automatically

**Step 3 — Build the IPA**
```bash
cd frontend
flutter build ios --release
```

Then in Xcode:
- Product → Archive
- When the Organizer opens, click "Distribute App"
- Choose "App Store Connect"
- Follow the steps to upload

**Step 4 — App Store Connect**
1. Go to https://appstoreconnect.apple.com
2. Create a new app
3. Fill in all metadata (name, description, screenshots)
4. Select the build you uploaded
5. Submit for review (takes 1–7 days)

---

### 4. Update the Server URL for Production

Before building the release app, update the server URL in:
`frontend/lib/utils/constants.dart`

```dart
// Change these to your actual production domain
static const String baseUrl = 'https://api.yourdomain.com';
static const String wsUrl   = 'wss://api.yourdomain.com/ws';
```

---

### 5. Production Server Setup

**Recommended: DigitalOcean Droplet or AWS EC2**
- Ubuntu 22.04 LTS
- Minimum: 2 CPU, 4GB RAM ($24/month on DigitalOcean)
- As users grow, scale to 4 CPU, 8GB RAM

**Step 1 — Install on server**
```bash
# Connect to your server
ssh root@YOUR_SERVER_IP

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install PostgreSQL
apt install -y postgresql postgresql-contrib
systemctl start postgresql

# Install Redis
apt install -y redis-server
systemctl start redis

# Clone your project
git clone https://github.com/YOUR_USERNAME/lds-ysa-app.git
cd lds-ysa-app/backend
npm install
cp .env.example .env
nano .env   # Fill in all production values
```

**Step 2 — Set up the database**
```bash
sudo -u postgres psql
CREATE USER lds_admin WITH PASSWORD 'strong_password_here';
CREATE DATABASE lds_ysa_db OWNER lds_admin;
\q

psql -U lds_admin -d lds_ysa_db -f ../database/migrations/001_schema.sql
psql -U lds_admin -d lds_ysa_db -f ../database/migrations/002_status.sql
psql -U lds_admin -d lds_ysa_db -f ../database/seeds/001_seed.sql
```

**Step 3 — Keep server running with PM2**
```bash
npm install -g pm2
pm2 start server.js --name lds-ysa-backend
pm2 save
pm2 startup   # Follow the command it gives you
```

**Step 4 — Nginx reverse proxy**
```bash
apt install -y nginx
nano /etc/nginx/sites-available/lds-ysa
```

Paste this config:
```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/lds-ysa /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
```

**Step 5 — SSL certificate (free)**
```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d api.yourdomain.com
```

This automatically renews every 90 days.

**Step 6 — Automatic daily backup**
```bash
crontab -e
# Add this line:
0 2 * * * pg_dump -U lds_admin lds_ysa_db > /backups/lds_ysa_$(date +\%Y\%m\%d).sql
```

---

### 6. Privacy Policy (Required for App Stores)

Both Google Play and Apple App Store require a privacy policy URL.
You must host a page that covers:

- What data you collect (phone number, name, age, church role, messages)
- How it is stored and protected (encrypted at rest and in transit)
- Who can see it (hierarchy-based access only)
- How users can delete their account
- That the app is for members of The Church of Jesus Christ of Latter-day Saints

Host this on a simple webpage at: `https://yourdomain.com/privacy`

---

### 7. App Store Screenshots Required

**Google Play:** Need screenshots for phone (required) and tablet (recommended)
**Apple App Store:** Need screenshots for 6.7" iPhone (required), 12.9" iPad (required)

Take screenshots of:
1. Home screen with scripture banner
2. Chat conversation
3. Status feed
4. Contact search
5. Login / Register screen

Use a real device or emulator at maximum quality.

---

## Checklist Before Submission

- [ ] Firebase push notifications tested on physical device
- [ ] Server URL changed from localhost to production domain
- [ ] SSL certificate installed on server
- [ ] Database backed up
- [ ] Privacy policy page live at a public URL
- [ ] App icon added (1024x1024 PNG, no rounded corners)
- [ ] Splash screen configured
- [ ] All screenshots taken
- [ ] App tested on both iOS and Android real devices
- [ ] Leader approval flow tested end-to-end
- [ ] Missionary mode tested — features correctly locked/unlocked
- [ ] Status 24-hour expiry confirmed working
- [ ] Push notifications received on locked screen
