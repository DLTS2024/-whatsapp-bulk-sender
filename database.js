const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

// Database connection config
// Database connection config
const dbConfig = {
    host: 'localhost',
    user: 'dltsclou_admin',
    password: 'whatsapp@123',
    database: 'dltsclou_whatsapp'
};

let pool = null;
let useInMemory = false;

// In-memory storage fallback
const inMemoryStorage = {
    users: [],
    licenses: [],
    templates: [],
    logs: []
};

// Initialize database connection
async function initDatabase() {
    try {
        pool = mysql.createPool(dbConfig);
        await pool.query('SELECT 1');
        console.log('✅ MySQL Database connected');
        useInMemory = false;
    } catch (error) {
        console.log('⚠️ MySQL not available, using in-memory storage');
        useInMemory = true;

        // Add default admin to memory
        const adminHash = await bcrypt.hash('admin123', 10);
        inMemoryStorage.users.push({
            id: 1,
            email: 'admin@whatsapp.com',
            password_hash: adminHash,
            name: 'Admin',
            is_admin: true,
            license_key: null,
            license_expires_at: null,
            created_at: new Date()
        });
    }
}

// Test connection
async function testConnection() {
    await initDatabase();
    return !useInMemory;
}

// ============ USER OPERATIONS ============

const UserDB = {
    async create(email, password, name, phone = null) {
        const password_hash = await bcrypt.hash(password, 10);

        if (useInMemory) {
            const user = {
                id: inMemoryStorage.users.length + 1,
                email,
                password_hash,
                name,
                phone,
                is_admin: false,
                license_key: null,
                license_expires_at: null,
                created_at: new Date()
            };
            inMemoryStorage.users.push(user);
            return { id: user.id, email, name };
        }

        const [result] = await pool.query(
            'INSERT INTO users (email, password_hash, name, phone) VALUES (?, ?, ?, ?)',
            [email, password_hash, name, phone]
        );
        return { id: result.insertId, email, name };
    },

    async findByEmail(email) {
        if (useInMemory) {
            return inMemoryStorage.users.find(u => u.email === email) || null;
        }

        const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
        return rows[0] || null;
    },

    async findById(id) {
        if (useInMemory) {
            return inMemoryStorage.users.find(u => u.id === id) || null;
        }

        const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
        return rows[0] || null;
    },

    // Alias for findById
    async getById(id) {
        return this.findById(id);
    },

    async verifyPassword(email, password) {
        const user = await this.findByEmail(email);
        if (!user) return null;

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return null;

        return user;
    },

    async updateLicense(userId, licenseKey, expiresAt) {
        if (useInMemory) {
            const user = inMemoryStorage.users.find(u => u.id === userId);
            if (user) {
                user.license_key = licenseKey;
                user.license_expires_at = expiresAt;
            }
            return true;
        }

        await pool.query(
            'UPDATE users SET license_key = ?, license_expires_at = ? WHERE id = ?',
            [licenseKey, expiresAt, userId]
        );
        return true;
    },

    async getAll() {
        if (useInMemory) {
            return inMemoryStorage.users.map(u => ({
                ...u,
                password_hash: undefined
            }));
        }

        const [rows] = await pool.query(
            'SELECT id, email, name, phone, is_admin, license_key, license_expires_at, created_at FROM users ORDER BY created_at DESC'
        );
        return rows;
    }
};

// ============ LICENSE OPERATIONS ============

const LicenseDB = {
    generateKey() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        const segments = [];
        for (let s = 0; s < 4; s++) {
            let segment = '';
            for (let i = 0; i < 4; i++) {
                segment += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            segments.push(segment);
        }
        return 'WA-' + segments.join('-');
    },

    async create(planName = '2 Year Plan', price = 999, durationDays = 730) {
        const licenseKey = this.generateKey();

        if (useInMemory) {
            const license = {
                id: inMemoryStorage.licenses.length + 1,
                license_key: licenseKey,
                user_id: null,
                plan_name: planName,
                price,
                duration_days: durationDays,
                activated_at: null,
                expires_at: null,
                status: 'unused',
                created_at: new Date()
            };
            inMemoryStorage.licenses.push(license);
            return license;
        }

        const [result] = await pool.query(
            'INSERT INTO licenses (license_key, plan_name, price, duration_days) VALUES (?, ?, ?, ?)',
            [licenseKey, planName, price, durationDays]
        );
        return { id: result.insertId, license_key: licenseKey, status: 'unused' };
    },

    async findByKey(licenseKey) {
        if (useInMemory) {
            return inMemoryStorage.licenses.find(l => l.license_key === licenseKey) || null;
        }

        const [rows] = await pool.query('SELECT * FROM licenses WHERE license_key = ?', [licenseKey]);
        return rows[0] || null;
    },

    async activate(licenseKey, userId) {
        const license = await this.findByKey(licenseKey);
        if (!license) return { success: false, error: 'Invalid license key' };
        if (license.status !== 'unused') return { success: false, error: 'License already used' };

        const activatedAt = new Date();
        const expiresAt = new Date(activatedAt.getTime() + (license.duration_days * 24 * 60 * 60 * 1000));

        if (useInMemory) {
            license.user_id = userId;
            license.activated_at = activatedAt;
            license.expires_at = expiresAt;
            license.status = 'active';
        } else {
            await pool.query(
                'UPDATE licenses SET user_id = ?, activated_at = ?, expires_at = ?, status = ? WHERE license_key = ?',
                [userId, activatedAt, expiresAt, 'active', licenseKey]
            );
        }

        // Update user's license info
        await UserDB.updateLicense(userId, licenseKey, expiresAt);

        return { success: true, expires_at: expiresAt };
    },

    async getAll() {
        if (useInMemory) {
            return inMemoryStorage.licenses;
        }

        const [rows] = await pool.query(`
            SELECT l.*, u.email as user_email, u.name as user_name 
            FROM licenses l 
            LEFT JOIN users u ON l.user_id = u.id 
            ORDER BY l.created_at DESC
        `);
        return rows;
    },

    async checkExpiry() {
        const now = new Date();

        if (useInMemory) {
            inMemoryStorage.licenses.forEach(l => {
                if (l.status === 'active' && l.expires_at && new Date(l.expires_at) < now) {
                    l.status = 'expired';
                }
            });
            return;
        }

        await pool.query(
            "UPDATE licenses SET status = 'expired' WHERE status = 'active' AND expires_at < NOW()"
        );
    },

    // Alias for findByKey (used by desktop app)
    async getByCode(licenseKey) {
        const license = await this.findByKey(licenseKey);
        if (!license) return null;

        // Map field names for compatibility
        return {
            ...license,
            expiry_date: license.expires_at,
            max_messages_per_day: license.max_messages || 1000
        };
    },

    // Update machine ID for desktop app
    async updateMachineId(licenseId, machineId) {
        if (useInMemory) {
            const license = inMemoryStorage.licenses.find(l => l.id === licenseId);
            if (license) license.machine_id = machineId;
            return;
        }

        await pool.query(
            'UPDATE licenses SET machine_id = ? WHERE id = ?',
            [machineId, licenseId]
        );
    },

    // Update last active timestamp
    async updateLastActive(licenseId) {
        if (useInMemory) {
            const license = inMemoryStorage.licenses.find(l => l.id === licenseId);
            if (license) license.last_active = new Date();
            return;
        }

        await pool.query(
            'UPDATE licenses SET last_active = NOW() WHERE id = ?',
            [licenseId]
        );
    }
};

// ============ TEMPLATE OPERATIONS ============

const TemplateDB = {
    async create(name, message, userId = null) {
        if (useInMemory) {
            const template = {
                id: inMemoryStorage.templates.length + 1,
                user_id: userId,
                name,
                message,
                created_at: new Date()
            };
            inMemoryStorage.templates.push(template);
            return template;
        }

        const [result] = await pool.query(
            'INSERT INTO templates (user_id, name, message) VALUES (?, ?, ?)',
            [userId, name, message]
        );
        return { id: result.insertId, user_id: userId, name, message };
    },

    async getAll(userId = null) {
        if (useInMemory) {
            return userId
                ? inMemoryStorage.templates.filter(t => t.user_id === userId)
                : inMemoryStorage.templates;
        }

        if (userId) {
            const [rows] = await pool.query('SELECT * FROM templates WHERE user_id = ? ORDER BY created_at DESC', [userId]);
            return rows;
        }
        const [rows] = await pool.query('SELECT * FROM templates ORDER BY created_at DESC');
        return rows;
    },

    async getById(id, userId = null) {
        if (useInMemory) {
            const template = inMemoryStorage.templates.find(t => t.id === id);
            if (userId && template && template.user_id !== userId) return null;
            return template || null;
        }

        let query = 'SELECT * FROM templates WHERE id = ?';
        let params = [id];
        if (userId) {
            query += ' AND user_id = ?';
            params.push(userId);
        }
        const [rows] = await pool.query(query, params);
        return rows[0] || null;
    },

    async update(id, name, message, userId = null) {
        if (useInMemory) {
            const template = inMemoryStorage.templates.find(t => t.id === id && (!userId || t.user_id === userId));
            if (template) {
                template.name = name;
                template.message = message;
            }
            return template;
        }

        let query = 'UPDATE templates SET name = ?, message = ? WHERE id = ?';
        let params = [name, message, id];
        if (userId) {
            query += ' AND user_id = ?';
            params.push(userId);
        }
        await pool.query(query, params);
        return { id, name, message };
    },

    async delete(id, userId = null) {
        if (useInMemory) {
            const index = inMemoryStorage.templates.findIndex(t => t.id === id && (!userId || t.user_id === userId));
            if (index !== -1) inMemoryStorage.templates.splice(index, 1);
            return true;
        }

        let query = 'DELETE FROM templates WHERE id = ?';
        let params = [id];
        if (userId) {
            query += ' AND user_id = ?';
            params.push(userId);
        }
        await pool.query(query, params);
        return true;
    }
};

// ============ MESSAGE LOG OPERATIONS ============

const MessageLogDB = {
    async create(phoneNumber, templateId, messageText, status, errorMessage = null, userId = null) {
        if (useInMemory) {
            const log = {
                id: inMemoryStorage.logs.length + 1,
                user_id: userId,
                phone_number: phoneNumber,
                template_id: templateId,
                message_text: messageText,
                status,
                error_message: errorMessage,
                sent_at: new Date()
            };
            inMemoryStorage.logs.push(log);
            return log;
        }

        const [result] = await pool.query(
            'INSERT INTO message_logs (user_id, phone_number, template_id, message_text, status, error_message) VALUES (?, ?, ?, ?, ?, ?)',
            [userId, phoneNumber, templateId, messageText, status, errorMessage]
        );
        return { id: result.insertId };
    },

    async getAll(userId = null, limit = 100) {
        if (useInMemory) {
            let logs = userId
                ? inMemoryStorage.logs.filter(l => l.user_id === userId)
                : inMemoryStorage.logs;
            return logs.slice(-limit).reverse();
        }

        let query = 'SELECT * FROM message_logs';
        let params = [];
        if (userId) {
            query += ' WHERE user_id = ?';
            params.push(userId);
        }
        query += ' ORDER BY sent_at DESC LIMIT ?';
        params.push(limit);

        const [rows] = await pool.query(query, params);
        return rows;
    },

    async getStats(userId = null) {
        if (useInMemory) {
            const logs = userId
                ? inMemoryStorage.logs.filter(l => l.user_id === userId)
                : inMemoryStorage.logs;
            return {
                total: logs.length,
                sent: logs.filter(l => l.status === 'sent').length,
                failed: logs.filter(l => l.status === 'failed').length
            };
        }

        let query = 'SELECT status, COUNT(*) as count FROM message_logs';
        let params = [];
        if (userId) {
            query += ' WHERE user_id = ?';
            params.push(userId);
        }
        query += ' GROUP BY status';

        const [rows] = await pool.query(query, params);
        const stats = { total: 0, sent: 0, failed: 0 };
        rows.forEach(row => {
            stats[row.status] = row.count;
            stats.total += row.count;
        });
        return stats;
    }
};

// ============ SETTINGS OPERATIONS ============

const inMemorySettings = {
    upi_id: 'your-upi-id@bank',
    upi_name: 'Your Business Name',
    whatsapp_number: '919876543210',
    license_price: '999',
    license_duration: '2 Years',
    qr_image: ''
};

const SettingsDB = {
    async getAll() {
        if (useInMemory) {
            return Object.entries(inMemorySettings).map(([key, value]) => ({
                setting_key: key,
                setting_value: value
            }));
        }

        const [rows] = await pool.query('SELECT setting_key, setting_value FROM settings');
        return rows;
    },

    async get(key) {
        if (useInMemory) {
            return inMemorySettings[key] || null;
        }

        const [rows] = await pool.query('SELECT setting_value FROM settings WHERE setting_key = ?', [key]);
        return rows[0]?.setting_value || null;
    },

    async getAllAsObject() {
        const settings = await this.getAll();
        const obj = {};
        settings.forEach(s => {
            obj[s.setting_key] = s.setting_value;
        });
        return obj;
    },

    async update(key, value) {
        if (useInMemory) {
            inMemorySettings[key] = value;
            return true;
        }

        await pool.query(
            'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
            [key, value, value]
        );
        return true;
    },

    async updateBulk(settings) {
        for (const [key, value] of Object.entries(settings)) {
            await this.update(key, value);
        }
        return true;
    }
};

module.exports = {
    testConnection,
    UserDB,
    LicenseDB,
    TemplateDB,
    MessageLogDB,
    SettingsDB
};
