const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const Store = require('electron-store');
const WhatsAppManager = require('./src/whatsapp');
const LicenseManager = require('./src/license');

// Initialize store for persistent data
const store = new Store();

// Global references
let mainWindow = null;
let tray = null;
let whatsappManager = null;
let licenseManager = null;

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
}

// Create main window
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        icon: path.join(__dirname, 'assets', 'icon.ico'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        frame: true,
        backgroundColor: '#111b21',
        show: false
    });

    // Check if licensed
    const license = store.get('license');
    if (license && license.key) {
        mainWindow.loadFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        mainWindow.loadFile(path.join(__dirname, 'public', 'login.html'));
    }

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    mainWindow.on('close', (event) => {
        event.preventDefault();
        mainWindow.hide();
    });
}

// Create system tray
function createTray() {
    const iconPath = path.join(__dirname, 'assets', 'icon.ico');
    tray = new Tray(iconPath);

    const contextMenu = Menu.buildFromTemplate([
        { label: 'Open App', click: () => mainWindow.show() },
        { label: 'WhatsApp Status', enabled: false },
        { type: 'separator' },
        {
            label: 'Quit', click: () => {
                if (whatsappManager) whatsappManager.destroy();
                app.exit(0);
            }
        }
    ]);

    tray.setToolTip('WhatsApp Bulk Sender');
    tray.setContextMenu(contextMenu);

    tray.on('double-click', () => mainWindow.show());
}

// Initialize managers
function initializeManagers() {
    licenseManager = new LicenseManager(store);
    whatsappManager = new WhatsAppManager();

    // WhatsApp events
    whatsappManager.on('qr', (qrDataUrl) => {
        if (mainWindow) {
            mainWindow.webContents.send('whatsapp:qr', qrDataUrl);
        }
    });

    whatsappManager.on('ready', () => {
        if (mainWindow) {
            mainWindow.webContents.send('whatsapp:ready');
        }
    });

    whatsappManager.on('disconnected', () => {
        if (mainWindow) {
            mainWindow.webContents.send('whatsapp:disconnected');
        }
    });

    whatsappManager.on('message-sent', (data) => {
        if (mainWindow) {
            mainWindow.webContents.send('whatsapp:message-sent', data);
        }
    });
}

// ============ IPC HANDLERS ============

// License verification
ipcMain.handle('license:verify', async (event, licenseKey) => {
    try {
        const result = await licenseManager.verify(licenseKey);
        if (result.valid) {
            store.set('license', { key: licenseKey, user: result.user });
            mainWindow.loadFile(path.join(__dirname, 'public', 'index.html'));
        }
        return result;
    } catch (error) {
        return { valid: false, error: error.message };
    }
});

ipcMain.handle('license:check', async () => {
    const license = store.get('license');
    if (!license) return { valid: false };
    return await licenseManager.verify(license.key);
});

ipcMain.handle('license:logout', async () => {
    store.delete('license');
    if (whatsappManager) {
        await whatsappManager.logout();
    }
    mainWindow.loadFile(path.join(__dirname, 'public', 'login.html'));
    return { success: true };
});

// WhatsApp operations
ipcMain.handle('whatsapp:initialize', async () => {
    try {
        await whatsappManager.initialize();
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('whatsapp:status', async () => {
    return {
        connected: whatsappManager ? whatsappManager.isReady : false
    };
});

ipcMain.handle('whatsapp:send', async (event, { phone, message, mediaPath }) => {
    try {
        const result = await whatsappManager.sendMessage(phone, message, mediaPath);
        return result;
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('whatsapp:send-bulk', async (event, { contacts, message, mediaPath, delay }) => {
    try {
        await whatsappManager.sendBulkMessages(contacts, message, mediaPath, delay);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('whatsapp:logout', async () => {
    try {
        await whatsappManager.logout();
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// File operations
ipcMain.handle('file:parse-excel', async (event, filePath) => {
    const XLSX = require('xlsx');
    try {
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
        return { success: true, data };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// App lifecycle
app.whenReady().then(() => {
    createWindow();
    createTray();
    initializeManagers();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    // Don't quit on macOS
    if (process.platform !== 'darwin') {
        // Keep running in tray
    }
});

app.on('before-quit', () => {
    if (whatsappManager) {
        whatsappManager.destroy();
    }
});
