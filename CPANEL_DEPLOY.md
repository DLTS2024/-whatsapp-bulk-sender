# WhatsApp Bulk Sender - cPanel Deployment Guide

**Domain:** wa.dltscloud.co.za  
**Hosting:** cPanel Cloud

---

## ⚠️ Important Note

WhatsApp Bulk Sender uses **Node.js + Puppeteer** which requires:
- SSH access (most cPanel cloud plans have this)
- Node.js selector or terminal access
- Persistent process (PM2)

If your cPanel doesn't support Node.js, you'll need a VPS instead.

---

## Step 1: Check Node.js Support

1. Login to cPanel
2. Look for **"Setup Node.js App"** or **"Node.js Selector"**
3. If available, continue. If not, contact hosting support.

---

## Step 2: Create MySQL Database

1. In cPanel, go to **MySQL Databases**
2. Create new database: `whatsapp_automation`
3. Create new user with password
4. Add user to database with **ALL PRIVILEGES**
5. Go to **phpMyAdmin** and import `database.sql`

---

## Step 3: Upload Files via File Manager

1. Go to **File Manager** in cPanel
2. Navigate to `/home/yourusername/` (not public_html)
3. Create folder: `whatsapp-app`
4. Upload all project files:
   - server.js
   - database.js
   - package.json
   - ecosystem.config.js
   - /public folder
   - /uploads folder

**Don't upload these:**
- node_modules/
- .wwebjs_auth/
- .env (create on server)

---

## Step 4: Setup Node.js App (cPanel Method)

If your cPanel has **Node.js Selector**:

1. Click **Setup Node.js App**
2. Click **Create Application**
3. Fill in:
   - **Node.js version:** 18.x or higher
   - **Application mode:** Production
   - **Application root:** /home/yourusername/whatsapp-app
   - **Application URL:** wa.dltscloud.co.za
   - **Application startup file:** server.js
4. Click **Create**
5. Click **Run NPM Install**

---

## Step 5: Setup via SSH (Alternative)

If Node.js Selector not available:

### 1. Connect via SSH
```bash
ssh username@wa.dltscloud.co.za
```

### 2. Navigate to app folder
```bash
cd ~/whatsapp-app
```

### 3. Install Node.js (if not installed)
```bash
# Check if node exists
node -v

# If not, use NodeSource
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 4. Install dependencies
```bash
npm install
```

### 5. Create .env file
```bash
nano .env
```
Add:
```
NODE_ENV=production
PORT=3000
DB_HOST=localhost
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=whatsapp_automation
JWT_SECRET=your-super-secret-key-change-this
```

### 6. Install PM2 globally
```bash
npm install -g pm2
```

### 7. Start the app
```bash
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup
```

---

## Step 6: Configure Reverse Proxy

### Option A: Using .htaccess (if Node.js on port 3000)

Create `.htaccess` in `public_html` or domain root:

```apache
RewriteEngine On
RewriteRule ^(.*)$ http://127.0.0.1:3000/$1 [P,L]
```

### Option B: Using Passenger (Recommended for cPanel)

Create `app.js` in app root:
```javascript
const app = require('./server.js');
// Passenger will handle the port
```

---

## Step 7: SSL Certificate

1. In cPanel, go to **SSL/TLS** or **Let's Encrypt SSL**
2. Select domain: wa.dltscloud.co.za
3. Install certificate
4. Force HTTPS in .htaccess:

```apache
RewriteEngine On
RewriteCond %{HTTPS} off
RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
```

---

## Step 8: Update Database Config

Edit `database.js` on server:

```javascript
const dbConfig = {
    host: 'localhost',
    user: 'your_cpanel_db_user',
    password: 'your_db_password',
    database: 'your_cpanel_database_name'
};
```

---

## Step 9: Test the App

1. Visit: https://wa.dltscloud.co.za
2. Should redirect to login page
3. Login as admin: admin@whatsapp.com / admin123
4. Scan QR code with WhatsApp

---

## Troubleshooting

### App not starting?
```bash
pm2 logs whatsapp-automation
```

### Puppeteer/Chrome issues?
Install dependencies:
```bash
sudo apt-get update
sudo apt-get install -y chromium-browser
sudo apt-get install -y libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libgbm1
```

### Database connection failed?
- Check credentials in database.js
- Ensure MySQL user has access to database

### WhatsApp QR not showing?
- Check if Puppeteer/Chrome is installed
- Check PM2 logs for errors

---

## Useful Commands

```bash
# View app status
pm2 status

# View logs
pm2 logs whatsapp-automation

# Restart app
pm2 restart whatsapp-automation

# Stop app
pm2 stop whatsapp-automation

# Delete and recreate
pm2 delete whatsapp-automation
pm2 start ecosystem.config.js
```

---

## Files Checklist

Make sure these files are uploaded:
- [ ] server.js
- [ ] database.js
- [ ] database.sql (imported to MySQL)
- [ ] package.json
- [ ] ecosystem.config.js
- [ ] .env (created on server)
- [ ] public/ (entire folder)
- [ ] uploads/ (create empty folder)
