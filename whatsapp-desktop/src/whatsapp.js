const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');

class WhatsAppManager extends EventEmitter {
    constructor() {
        super();
        this.client = null;
        this.isReady = false;
        this.qrCode = null;
    }

    async initialize() {
        console.log('🔄 Initializing WhatsApp client...');

        // Auth data path
        const authPath = path.join(require('os').homedir(), '.whatsapp-bulk-sender', 'auth');
        if (!fs.existsSync(authPath)) {
            fs.mkdirSync(authPath, { recursive: true });
        }

        this.client = new Client({
            authStrategy: new LocalAuth({
                dataPath: authPath
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--disable-gpu'
                ]
            }
        });

        // QR Code event
        this.client.on('qr', async (qr) => {
            console.log('📱 QR Code received');
            this.qrCode = await qrcode.toDataURL(qr);
            this.emit('qr', this.qrCode);
        });

        // Authenticated event
        this.client.on('authenticated', () => {
            console.log('🔐 WhatsApp authenticated');
            this.qrCode = null;
        });

        // Ready event
        this.client.on('ready', () => {
            console.log('✅ WhatsApp Client is ready!');
            this.isReady = true;
            this.emit('ready');
        });

        // Disconnected event
        this.client.on('disconnected', (reason) => {
            console.log('❌ WhatsApp disconnected:', reason);
            this.isReady = false;
            this.emit('disconnected', reason);
        });

        // Initialize
        await this.client.initialize();
    }

    async sendMessage(phone, message, mediaPath = null) {
        try {
            if (!this.isReady) {
                throw new Error('WhatsApp not connected');
            }

            // Format phone number
            let formattedPhone = phone.replace(/[^0-9]/g, '');
            if (!formattedPhone.includes('@c.us')) {
                formattedPhone = formattedPhone + '@c.us';
            }

            // Check if registered
            const isRegistered = await this.client.isRegisteredUser(formattedPhone);
            if (!isRegistered) {
                return { success: false, error: 'Number not on WhatsApp', phone };
            }

            // Send with media if provided
            if (mediaPath && fs.existsSync(mediaPath)) {
                const media = MessageMedia.fromFilePath(mediaPath);
                await this.client.sendMessage(formattedPhone, media, { caption: message });
            } else {
                await this.client.sendMessage(formattedPhone, message);
            }

            return { success: true, phone };

        } catch (error) {
            console.error('Send error:', error);
            return { success: false, error: error.message, phone };
        }
    }

    async sendBulkMessages(contacts, message, mediaPath, delay = 3000) {
        let sent = 0;
        let failed = 0;

        for (let i = 0; i < contacts.length; i++) {
            const contact = contacts[i];
            const phone = contact.phone || contact.Phone || contact.number || contact.Number;
            const name = contact.name || contact.Name || 'Customer';

            // Personalize message
            let personalizedMessage = message.replace(/\{name\}/gi, name);

            try {
                const result = await this.sendMessage(phone, personalizedMessage, mediaPath);

                if (result.success) {
                    sent++;
                } else {
                    failed++;
                }

                this.emit('message-sent', {
                    current: i + 1,
                    total: contacts.length,
                    phone,
                    name,
                    status: result.success ? 'sent' : 'failed',
                    error: result.error
                });

                // Delay between messages
                if (i < contacts.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                }

            } catch (error) {
                failed++;
                this.emit('message-sent', {
                    current: i + 1,
                    total: contacts.length,
                    phone,
                    name,
                    status: 'failed',
                    error: error.message
                });
            }
        }

        this.emit('sending-complete', { sent, failed });
        return { sent, failed };
    }

    async logout() {
        try {
            if (this.client) {
                await this.client.logout();
                this.isReady = false;
            }
        } catch (error) {
            console.error('Logout error:', error);
        }
    }

    destroy() {
        try {
            if (this.client) {
                this.client.destroy();
                this.client = null;
                this.isReady = false;
            }
        } catch (error) {
            console.error('Destroy error:', error);
        }
    }
}

module.exports = WhatsAppManager;
