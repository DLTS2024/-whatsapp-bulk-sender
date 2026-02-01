const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const XLSX = require('xlsx');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const jwt = require('jsonwebtoken');
const { testConnection, UserDB, LicenseDB, TemplateDB, MessageLogDB, SettingsDB } = require('./database');

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

// File upload configuration
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

// WhatsApp Client Configuration
let whatsappClient = null;
let isClientReady = false;
let qrCodeData = null;

function initializeWhatsAppClient() {
    whatsappClient = new Client({
        authStrategy: new LocalAuth({
            dataPath: './.wwebjs_auth'
        }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        }
    });

    // QR Code event
    whatsappClient.on('qr', async (qr) => {
        console.log('📱 QR Code received');
        qrCodeData = await qrcode.toDataURL(qr);
        io.emit('qr', qrCodeData);
        io.emit('status', { connected: false, message: 'Scan QR Code with WhatsApp' });
    });

    // Ready event
    whatsappClient.on('ready', () => {
        console.log('✅ WhatsApp Client is ready!');
        isClientReady = true;
        qrCodeData = null;
        io.emit('ready', { connected: true });
        io.emit('status', { connected: true, message: 'WhatsApp Connected!' });
    });

    // Authenticated event
    whatsappClient.on('authenticated', () => {
        console.log('🔐 WhatsApp authenticated');
        io.emit('status', { connected: false, message: 'Authenticated, loading...' });
    });

    // Auth failure
    whatsappClient.on('auth_failure', (msg) => {
        console.error('❌ Authentication failed:', msg);
        io.emit('status', { connected: false, message: 'Authentication failed. Restart the server.' });
    });

    // Disconnected
    whatsappClient.on('disconnected', (reason) => {
        console.log('🔌 WhatsApp disconnected:', reason);
        isClientReady = false;
        io.emit('status', { connected: false, message: 'Disconnected. Reconnecting...' });
        // Reinitialize after disconnect
        setTimeout(() => {
            initializeWhatsAppClient();
        }, 5000);
    });

    // Initialize
    whatsappClient.initialize();
}

// Socket.IO Connection
io.on('connection', (socket) => {
    console.log('🔌 Client connected:', socket.id);

    // Send current status
    if (isClientReady) {
        socket.emit('ready', { connected: true });
        socket.emit('status', { connected: true, message: 'WhatsApp Connected!' });
    } else if (qrCodeData) {
        socket.emit('qr', qrCodeData);
        socket.emit('status', { connected: false, message: 'Scan QR Code with WhatsApp' });
    } else {
        socket.emit('status', { connected: false, message: 'Initializing WhatsApp...' });
    }

    socket.on('disconnect', () => {
        console.log('🔌 Client disconnected:', socket.id);
    });
});

// ============ API ROUTES ============

// Auth Middleware
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

// Admin Middleware
const requireAdmin = async (req, res, next) => {
    const user = await UserDB.findById(req.user.id);
    if (!user || !user.is_admin) {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

// ============ AUTH ROUTES ============

// Signup
app.post('/api/signup', async (req, res) => {
    try {
        const { name, email, password, phone } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email and password required' });
        }

        // Check if email already exists
        const existingUser = await UserDB.findByEmail(email);
        if (existingUser) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        // Create user
        const user = await UserDB.create(email, password, name, phone);

        // Generate token
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

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        // Verify credentials
        const user = await UserDB.verifyPassword(email, password);
        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Check license expiry
        await LicenseDB.checkExpiry();

        // Generate token
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

// Get current user
app.get('/api/user/profile', authenticateToken, async (req, res) => {
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

// Activate License
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

// Admin Stats
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

// Get all licenses
app.get('/api/admin/licenses', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const licenses = await LicenseDB.getAll();
        res.json(licenses);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Generate new license
app.post('/api/admin/generate-license', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const license = await LicenseDB.create();
        res.json(license);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all users
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const users = await UserDB.getAll();
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all settings (admin only)
app.get('/api/admin/settings', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const settings = await SettingsDB.getAllAsObject();
        res.json(settings);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update settings (admin only)
app.post('/api/admin/settings', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const settings = req.body;
        await SettingsDB.updateBulk(settings);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Upload QR code image (admin only)
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

// Public settings (for activate page)
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

// Get connection status
app.get('/api/status', (req, res) => {
    res.json({
        connected: isClientReady,
        hasQR: !!qrCodeData
    });
});

// Logout / Disconnect WhatsApp
app.post('/api/logout', async (req, res) => {
    try {
        if (whatsappClient) {
            await whatsappClient.logout();
            isClientReady = false;
            qrCodeData = null;
            io.emit('status', { connected: false, message: 'Logged out. Scan QR to reconnect.' });
            console.log('📴 WhatsApp logged out');

            // Reinitialize after logout
            setTimeout(() => {
                initializeWhatsAppClient();
            }, 2000);
        }
        res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Chat cache for faster loading
let chatCache = [];
let lastChatUpdate = 0;

// Get recent chats (with caching)
app.get('/api/chats', async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(400).json({ error: 'WhatsApp not connected' });
        }

        // Use cache if less than 30 seconds old
        const now = Date.now();
        if (chatCache.length > 0 && (now - lastChatUpdate) < 30000) {
            return res.json(chatCache);
        }

        const chats = await whatsappClient.getChats();
        chatCache = chats.slice(0, 25).map(chat => ({
            id: chat.id._serialized,
            name: chat.name || chat.id.user,
            isGroup: chat.isGroup,
            unreadCount: chat.unreadCount || 0,
            timestamp: chat.timestamp,
            lastMessage: chat.lastMessage ? {
                body: chat.lastMessage.body?.substring(0, 40) || '',
                fromMe: chat.lastMessage.fromMe,
                timestamp: chat.lastMessage.timestamp
            } : null
        }));
        lastChatUpdate = now;

        res.json(chatCache);
    } catch (error) {
        // Return cached data on error
        if (chatCache.length > 0) {
            return res.json(chatCache);
        }
        res.status(500).json({ error: error.message });
    }
});

// Get profile picture
app.get('/api/profile-pic/:chatId', async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(400).json({ error: 'WhatsApp not connected' });
        }
        const profilePic = await whatsappClient.getProfilePicUrl(req.params.chatId);
        res.json({ url: profilePic || null });
    } catch (error) {
        res.json({ url: null });
    }
});

// Get messages from a specific chat
app.get('/api/chat/:chatId/messages', async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(400).json({ error: 'WhatsApp not connected' });
        }

        const chat = await whatsappClient.getChatById(req.params.chatId);
        const messages = await chat.fetchMessages({ limit: 50 });

        const messageList = messages.map(msg => ({
            id: msg.id._serialized,
            body: msg.body,
            fromMe: msg.fromMe,
            timestamp: msg.timestamp,
            type: msg.type,
            hasMedia: msg.hasMedia,
            author: msg.author || null,
            isForwarded: msg.isForwarded
        }));

        res.json({
            chatId: req.params.chatId,
            chatName: chat.name || chat.id.user,
            isGroup: chat.isGroup,
            messages: messageList
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Send message to a specific chat
app.post('/api/chat/:chatId/send', async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(400).json({ error: 'WhatsApp not connected' });
        }

        const { message } = req.body;
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        await whatsappClient.sendMessage(req.params.chatId, message);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ TEMPLATE ROUTES ============

// Get all templates
app.get('/api/templates', async (req, res) => {
    try {
        const templates = await TemplateDB.getAll();
        res.json(templates);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create template
app.post('/api/templates', async (req, res) => {
    try {
        const { name, message } = req.body;
        if (!name || !message) {
            return res.status(400).json({ error: 'Name and message are required' });
        }
        const template = await TemplateDB.create(name, message);
        res.json(template);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update template
app.put('/api/templates/:id', async (req, res) => {
    try {
        const { name, message } = req.body;
        const template = await TemplateDB.update(req.params.id, name, message);
        res.json(template);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete template
app.delete('/api/templates/:id', async (req, res) => {
    try {
        await TemplateDB.delete(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ EXCEL UPLOAD ROUTE ============

app.post('/api/upload-excel', upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const workbook = XLSX.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet);

        // Extract phone numbers and names
        const contacts = [];
        const phoneColumns = ['phone', 'Phone', 'PHONE', 'phone_number', 'Phone Number', 'mobile', 'Mobile', 'MOBILE', 'number', 'Number'];
        const nameColumns = ['name', 'Name', 'NAME', 'contact_name', 'Contact Name'];

        data.forEach(row => {
            let phone = null;
            let name = '';

            // Find phone
            for (const col of phoneColumns) {
                if (row[col]) {
                    phone = String(row[col]).replace(/\D/g, '');
                    if (phone.length === 10) phone = '91' + phone;
                    break;
                }
            }

            // Find name
            for (const col of nameColumns) {
                if (row[col]) {
                    name = String(row[col]).trim();
                    break;
                }
            }

            if (phone && phone.length >= 10) {
                contacts.push({ phone, name });
            }
        });

        fs.unlinkSync(req.file.path);

        res.json({
            success: true,
            contacts: contacts,
            count: contacts.length
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ MEDIA UPLOAD ROUTE ============

app.post('/api/upload-media', upload.single('media'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        res.json({
            success: true,
            filePath: req.file.path,
            fileName: req.file.originalname,
            mimeType: req.file.mimetype
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ MESSAGE SENDING ROUTE ============

app.post('/api/send-messages', async (req, res) => {
    try {
        const { contacts, templateId, message, mediaPath } = req.body;

        if (!isClientReady) {
            return res.status(400).json({ error: 'WhatsApp is not connected' });
        }

        if (!contacts || contacts.length === 0) {
            return res.status(400).json({ error: 'No contacts provided' });
        }

        if (!message) {
            return res.status(400).json({ error: 'No message provided' });
        }

        // Start sending messages in the background
        sendBulkMessages(contacts, templateId, message, mediaPath);

        res.json({
            success: true,
            message: 'Message sending started',
            totalNumbers: contacts.length
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Bulk message sending function
async function sendBulkMessages(contacts, templateId, messageTemplate, mediaPath) {
    const total = contacts.length;
    let sent = 0;
    let failed = 0;

    // Load media if provided
    let media = null;
    if (mediaPath && fs.existsSync(mediaPath)) {
        media = MessageMedia.fromFilePath(mediaPath);
    }

    io.emit('sending-start', { total });

    for (let i = 0; i < contacts.length; i++) {
        const { phone, name } = contacts[i];
        const chatId = phone + '@c.us';

        // Personalize message - replace {name} with actual name
        let personalizedMessage = messageTemplate.replace(/{name}/gi, name || 'Friend');

        try {
            // Send media with caption if media exists
            if (media) {
                await whatsappClient.sendMessage(chatId, media, { caption: personalizedMessage });
            } else {
                await whatsappClient.sendMessage(chatId, personalizedMessage);
            }
            sent++;
            await MessageLogDB.create(phone, templateId, personalizedMessage, 'sent');
            io.emit('message-sent', {
                phone,
                name,
                status: 'sent',
                current: i + 1,
                total,
                sent,
                failed
            });
        } catch (error) {
            failed++;
            await MessageLogDB.create(phone, templateId, personalizedMessage, 'failed', error.message);
            io.emit('message-sent', {
                phone,
                name,
                status: 'failed',
                error: error.message,
                current: i + 1,
                total,
                sent,
                failed
            });
        }

        // Delay between messages (30 seconds)
        if (i < contacts.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 30000));
        }
    }

    // Clean up media file after sending
    if (mediaPath && fs.existsSync(mediaPath)) {
        fs.unlinkSync(mediaPath);
    }

    io.emit('sending-complete', { total, sent, failed });
}

// ============ MESSAGE LOGS ROUTE ============

app.get('/api/logs', async (req, res) => {
    try {
        const logs = await MessageLogDB.getRecent(100);
        res.json(logs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/stats', async (req, res) => {
    try {
        const stats = await MessageLogDB.getStats();
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ START SERVER ============

const PORT = process.env.PORT || 3000;

async function startServer() {
    // Test database connection
    await testConnection();

    // Initialize WhatsApp client
    initializeWhatsAppClient();

    // Start server
    server.listen(PORT, () => {
        console.log(`🚀 Server running at http://localhost:${PORT}`);
        console.log('📱 Waiting for WhatsApp connection...');
    });
}

startServer();

// Export for Passenger (cPanel)
module.exports = app;
