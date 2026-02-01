# WhatsApp Automation - Hostinger Deployment Guide

## 📦 Pre-requisites
- Hostinger Cloud Hosting (Turbo Cloud plan)
- Domain connected to Hostinger
- SSH/Terminal access enabled

---

## 🚀 Step-by-Step Deployment

### Step 1: Login to Hostinger hPanel
1. Go to https://hpanel.hostinger.com
2. Click on your hosting plan
3. Go to **Advanced** → **SSH Access**
4. Enable SSH and note the credentials

### Step 2: Connect via SSH
```bash
ssh u123456789@your-server-ip -p 65002
```

### Step 3: Create App Directory
```bash
cd public_html
mkdir whatsapp-automation
cd whatsapp-automation
```

### Step 4: Upload Files
Option A: **Using File Manager**
1. Go to hPanel → Files → File Manager
2. Navigate to public_html/whatsapp-automation
3. Upload all project files (ZIP and extract)

Option B: **Using Git** (if repo exists)
```bash
git clone https://github.com/your-username/whatsapp-automation.git .
```

### Step 5: Install Dependencies
```bash
npm install --production
```

### Step 6: Install PM2 (Process Manager)
```bash
npm install -g pm2
```

### Step 7: Start the Application
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### Step 8: Setup Domain Proxy (Important!)
In hPanel:
1. Go to **Websites** → **Node.js**
2. Click **Create Application**
3. Set:
   - Node.js Version: 18.x or 20.x
   - Application root: public_html/whatsapp-automation
   - Application startup file: server.js
   - Port: 3000

---

## 🔧 Hostinger Node.js Setup (Alternative Method)

If Hostinger has Node.js hosting panel:

1. Go to **Advanced** → **Node.js**
2. Create new Node.js app:
   - Root: /public_html/whatsapp-automation
   - Entry file: server.js
   - Node version: 18+
3. Click **NPM Install**
4. Click **Restart**

---

## 📁 Required Files to Upload

```
whatsapp-automation/
├── server.js
├── database.js
├── package.json
├── ecosystem.config.js
├── public/
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── uploads/          (create empty folder)
└── .wwebjs_auth/     (will be created on first run)
```

---

## 🔐 Important Notes

1. **WhatsApp Session**: 
   - `.wwebjs_auth` folder stores your WhatsApp session
   - Don't delete this folder or you'll need to scan QR again

2. **Puppeteer on Server**:
   May need additional packages:
   ```bash
   # If Puppeteer fails, run:
   sudo apt-get install chromium-browser
   ```

3. **File Permissions**:
   ```bash
   chmod -R 755 public_html/whatsapp-automation
   chmod -R 777 uploads
   chmod -R 777 .wwebjs_auth
   ```

---

## 🌐 Access Your App

After setup, your app will be available at:
- `https://yourdomain.com` (if configured as main site)
- OR `https://yourdomain.com:3000` (direct port access)

---

## 🔄 Useful PM2 Commands

```bash
pm2 status              # Check app status
pm2 logs               # View logs
pm2 restart all        # Restart app
pm2 stop all           # Stop app
pm2 delete all         # Remove app from PM2
```

---

## ❌ Troubleshooting

**App not starting?**
```bash
pm2 logs --lines 50
```

**Puppeteer/Chrome errors?**
Add to server.js puppeteer args:
```javascript
puppeteer: {
    headless: true,
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--single-process'
    ],
    executablePath: '/usr/bin/chromium-browser'
}
```

**Port already in use?**
```bash
pm2 delete all
pm2 start ecosystem.config.js
```
