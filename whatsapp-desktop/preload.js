const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
    // License operations
    license: {
        verify: (key) => ipcRenderer.invoke('license:verify', key),
        check: () => ipcRenderer.invoke('license:check'),
        logout: () => ipcRenderer.invoke('license:logout')
    },

    // WhatsApp operations
    whatsapp: {
        initialize: () => ipcRenderer.invoke('whatsapp:initialize'),
        status: () => ipcRenderer.invoke('whatsapp:status'),
        send: (data) => ipcRenderer.invoke('whatsapp:send', data),
        sendBulk: (data) => ipcRenderer.invoke('whatsapp:send-bulk', data),
        logout: () => ipcRenderer.invoke('whatsapp:logout'),

        // Event listeners
        onQR: (callback) => ipcRenderer.on('whatsapp:qr', (event, qr) => callback(qr)),
        onReady: (callback) => ipcRenderer.on('whatsapp:ready', () => callback()),
        onDisconnected: (callback) => ipcRenderer.on('whatsapp:disconnected', () => callback()),
        onMessageSent: (callback) => ipcRenderer.on('whatsapp:message-sent', (event, data) => callback(data))
    },

    // File operations
    file: {
        parseExcel: (filePath) => ipcRenderer.invoke('file:parse-excel', filePath)
    }
});
