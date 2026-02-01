const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const XLSX = require('xlsx');
const jwt = require('jsonwebtoken');
const { testConnection, UserDB, LicenseDB, TemplateDB, MessageLogDB, SettingsDB } = require('./database');

// ============ CONFIGURATION ============
// Render WhatsApp API URL - Change this to your Render URL
const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL || 'https://whatsapp-api-89yn.onrender.com';
const WHATSAPP_API_KEY = process.env.WHATSAPP_API_KEY || 'dlts-whatsapp-secret-2024';

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'whatsapp-bulk-sender-secret-key-2024';

// Initialize Express
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// File Upload Configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

// Create uploads directory if it doesn't exist
const fs = require('fs');
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// WhatsApp Status (from Render API)
let isClientReady = false;
let qrCodeData = null;

// ============ WHATSAPP API HELPER ============

async function callWhatsAppAPI(endpoint, method = 'GET', body = null) {
    try {
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json',
                'X-API-KEY': WHATSAPP_API_KEY
            }
        };

        if (body) {
            options.body = JSON.stringify(body);
        }

        const response = await fetch(`${WHATSAPP_API_URL}${endpoint}`, options);
        return await response.json();
    } catch (error) {
        console.error('WhatsApp API Error:', error);
        return { error: error.message };
    }
}

// Poll WhatsApp status every 5 seconds
async function pollWhatsAppStatus() {
    try {
        const status = await callWhatsAppAPI('/api/status');
        const wasReady = isClientReady;

        isClientReady = status.connected || false;

        if (status.hasQR) {
            const qrData = await callWhatsAppAPI('/api/qr');
            qrCodeData = qrData.qr;
            io.emit('qr', qrCodeData);
        } else if (isClientReady && !wasReady) {
            qrCodeData = null;
            io.emit('ready');
        } else if (!isClientReady && !status.hasQR) {
            io.emit('disconnected');
        }
    } catch (error) {
        console.error('Poll error:', error);
    }
}

// Start polling
setInterval(pollWhatsAppStatus, 5000);

// ============ AUTHENTICATION MIDDLEWARE ============

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
};

const requireAdmin = async (req, res, next) => {
    const user = await UserDB.findById(req.user.id);
    if (!user || !user.is_admin) {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

// ============ AUTH ROUTES ============

app.post('/api/signup', async (req, res) => {
    try {
        const { name, email, password, phone } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email and password required' });
        }

        const existingUser = await UserDB.findByEmail(email);
        if (existingUser) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        const user = await UserDB.create(email, password, name, phone);
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                name,
                email,
                is_admin: false,
                license_key: null
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        const user = await UserDB.verifyPassword(email, password);
        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        await LicenseDB.checkExpiry();

        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                is_admin: user.is_admin,
                license_key: user.license_key,
                license_expires_at: user.license_expires_at
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/user', authenticateToken, async (req, res) => {
    try {
        const user = await UserDB.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({
            id: user.id,
            name: user.name,
            email: user.email,
            is_admin: user.is_admin,
            license_key: user.license_key,
            license_expires_at: user.license_expires_at
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ LICENSE ROUTES ============

app.post('/api/activate-license', authenticateToken, async (req, res) => {
    try {
        const { licenseKey } = req.body;

        if (!licenseKey) {
            return res.status(400).json({ error: 'License key required' });
        }

        const result = await LicenseDB.activate(licenseKey, req.user.id);

        if (result.success) {
            res.json({
                success: true,
                license_key: licenseKey,
                expires_at: result.expires_at
            });
        } else {
            res.status(400).json({ error: result.error });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ ADMIN ROUTES ============

app.get('/api/admin/stats', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const users = await UserDB.getAll();
        const licenses = await LicenseDB.getAll();

        res.json({
            totalUsers: users.filter(u => !u.is_admin).length,
            activeLicenses: licenses.filter(l => l.status === 'active').length,
            unusedLicenses: licenses.filter(l => l.status === 'unused').length,
            expiredLicenses: licenses.filter(l => l.status === 'expired').length
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/licenses', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const licenses = await LicenseDB.getAll();
        res.json(licenses);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/generate-license', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const license = await LicenseDB.create();
        res.json(license);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const users = await UserDB.getAll();
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/settings', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const settings = await SettingsDB.getAllAsObject();
        res.json(settings);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/settings', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const settings = req.body;
        await SettingsDB.updateBulk(settings);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/upload-qr', authenticateToken, requireAdmin, upload.single('qr_image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        const qrPath = '/uploads/' + req.file.filename;
        await SettingsDB.update('qr_image', qrPath);
        res.json({ success: true, path: qrPath });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/public/payment-settings', async (req, res) => {
    try {
        const settings = await SettingsDB.getAllAsObject();
        res.json({
            upi_id: settings.upi_id || 'your-upi-id@bank',
            upi_name: settings.upi_name || 'Your Business Name',
            whatsapp_number: settings.whatsapp_number || '919876543210',
            license_price: settings.license_price || '999',
            license_duration: settings.license_duration || '2 Years',
            qr_image: settings.qr_image || ''
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ WHATSAPP STATUS ROUTES ============

app.get('/api/status', (req, res) => {
    res.json({
        connected: isClientReady,
        hasQR: !!qrCodeData
    });
});

app.post('/api/logout', async (req, res) => {
    try {
        const result = await callWhatsAppAPI('/api/logout', 'POST');
        isClientReady = false;
        qrCodeData = null;
        io.emit('disconnected');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ TEMPLATE ROUTES ============

app.get('/api/templates', authenticateToken, async (req, res) => {
    try {
        const templates = await TemplateDB.getAll(req.user.id);
        res.json(templates);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/templates', authenticateToken, async (req, res) => {
    try {
        const { name, message } = req.body;
        const template = await TemplateDB.create(name, message, req.user.id);
        res.json(template);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/templates/:id', authenticateToken, async (req, res) => {
    try {
        const { name, message } = req.body;
        const template = await TemplateDB.update(parseInt(req.params.id), name, message, req.user.id);
        res.json(template);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/templates/:id', authenticateToken, async (req, res) => {
    try {
        await TemplateDB.delete(parseInt(req.params.id), req.user.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ EXCEL UPLOAD ============

app.post('/api/upload-excel', upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const workbook = XLSX.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet);

        const contacts = data.map(row => {
            const phone = row.phone || row.Phone || row.PHONE ||
                row.mobile || row.Mobile || row.MOBILE ||
                row.number || row.Number || row.NUMBER ||
                Object.values(row)[0];
            return { phone: String(phone).replace(/[^0-9]/g, '') };
        }).filter(c => c.phone && c.phone.length >= 10);

        fs.unlinkSync(req.file.path);

        res.json({ contacts });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ SEND MESSAGES (VIA RENDER API) ============

app.post('/api/send-bulk', authenticateToken, async (req, res) => {
    try {
        const { contacts, message, mediaPath } = req.body;

        if (!contacts || !message) {
            return res.status(400).json({ error: 'Contacts and message required' });
        }

        // Start sending in background
        sendBulkMessages(contacts, message, mediaPath, req.user.id);

        res.json({ success: true, message: 'Sending started' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

async function sendBulkMessages(contacts, message, mediaPath, userId) {
    let sent = 0;
    let failed = 0;
    const total = contacts.length;

    io.emit('sending-started', { total });

    for (let i = 0; i < contacts.length; i++) {
        const contact = contacts[i];

        try {
            const result = await callWhatsAppAPI('/api/send', 'POST', {
                phone: contact.phone,
                message: message,
                mediaUrl: mediaPath ? `${WHATSAPP_API_URL}${mediaPath}` : null
            });

            if (result.success) {
                sent++;
                await MessageLogDB.create(contact.phone, null, message, 'sent', null, userId);
                io.emit('message-sent', { phone: contact.phone, status: 'sent' });
            } else {
                failed++;
                await MessageLogDB.create(contact.phone, null, message, 'failed', result.error, userId);
                io.emit('message-sent', { phone: contact.phone, status: 'failed', error: result.error });
            }
        } catch (error) {
            failed++;
            await MessageLogDB.create(contact.phone, null, message, 'failed', error.message, userId);
            io.emit('message-sent', { phone: contact.phone, status: 'failed', error: error.message });
        }

        io.emit('sending-progress', { sent, failed, total, current: i + 1 });

        // Delay between messages (30 seconds)
        if (i < contacts.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 30000));
        }
    }

    io.emit('sending-complete', { total, sent, failed });
}

// ============ MESSAGE LOGS ============

app.get('/api/logs', authenticateToken, async (req, res) => {
    try {
        const logs = await MessageLogDB.getAll(req.user.id);
        res.json(logs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/stats', authenticateToken, async (req, res) => {
    try {
        const stats = await MessageLogDB.getStats(req.user.id);
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ SOCKET.IO ============

io.on('connection', (socket) => {
    console.log('🔌 Client connected:', socket.id);

    // Send current status
    socket.emit('status', { connected: isClientReady });

    if (qrCodeData) {
        socket.emit('qr', qrCodeData);
    } else if (isClientReady) {
        socket.emit('ready');
    }

    socket.on('disconnect', () => {
        console.log('🔌 Client disconnected:', socket.id);
    });
});

// ============ START SERVER ============

const PORT = process.env.PORT || 3000;

async function startServer() {
    await testConnection();

    // Initial WhatsApp status check
    await pollWhatsAppStatus();

    server.listen(PORT, () => {
        console.log(`🚀 Server running at http://localhost:${PORT}`);
        console.log(`📡 WhatsApp API: ${WHATSAPP_API_URL}`);
    });
}

startServer();

// Export for Passenger (cPanel)
module.exports = app;
