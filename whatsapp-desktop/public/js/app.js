// WhatsApp Bulk Sender - Frontend JavaScript

// Elements
const qrSection = document.getElementById('qrSection');
const automationSection = document.getElementById('automationSection');
const qrSpinner = document.getElementById('qrSpinner');
const qrCode = document.getElementById('qrCode');
const statusPill = document.getElementById('statusPill');
const logoutBtn = document.getElementById('logoutBtn');

// Stats
const totalContactsEl = document.getElementById('totalContacts');
const sentCountEl = document.getElementById('sentCount');
const failedCountEl = document.getElementById('failedCount');

// Form elements
const contactFile = document.getElementById('contactFile');
const messageText = document.getElementById('messageText');
const mediaFile = document.getElementById('mediaFile');
const delaySelect = document.getElementById('delaySelect');
const sendBtn = document.getElementById('sendBtn');

// Progress
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const liveLog = document.getElementById('liveLog');

// State
let contacts = [];
let sentCount = 0;
let failedCount = 0;
let isSending = false;

// Initialize
async function initialize() {
    updateStatus('Connecting...', false);

    // Initialize WhatsApp
    await window.electronAPI.whatsapp.initialize();

    // Setup event listeners
    window.electronAPI.whatsapp.onQR((qrDataUrl) => {
        console.log('QR received');
        qrSpinner.style.display = 'none';
        qrCode.src = qrDataUrl;
        qrCode.style.display = 'block';
        document.getElementById('authError').style.display = 'none';
        updateStatus('Scan QR Code', false);
    });

    window.electronAPI.whatsapp.onReady(() => {
        console.log('WhatsApp ready');
        updateStatus('Connected', true);
        showAutomationSection();
    });

    window.electronAPI.whatsapp.onDisconnected(() => {
        console.log('WhatsApp disconnected');
        updateStatus('Disconnected', false);
        showQRSection();
    });

    window.electronAPI.whatsapp.onAuthFailure(() => {
        console.log('Auth failed');
        qrSpinner.style.display = 'none';
        qrCode.style.display = 'none';
        document.getElementById('authError').style.display = 'block';
        updateStatus('Link Failed', false);
    });

    window.electronAPI.whatsapp.onMessageSent((data) => {
        handleMessageSent(data);
    });
}

// Clear session and retry
async function clearAndRetry() {
    updateStatus('Clearing...', false);
    document.getElementById('authError').style.display = 'none';
    qrSpinner.style.display = 'block';
    qrCode.style.display = 'none';

    await window.electronAPI.whatsapp.clearSession();
    showToast('Session cleared, restarting...', 'success');

    // Re-initialize
    setTimeout(async () => {
        await window.electronAPI.whatsapp.initialize(true);
    }, 1000);
}

// Setup clear session buttons
document.getElementById('retryBtn')?.addEventListener('click', clearAndRetry);
document.getElementById('clearSessionLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    clearAndRetry();
});

// Update status
function updateStatus(text, connected) {
    const statusSpan = statusPill.querySelector('span:last-child');
    statusSpan.textContent = text;

    if (connected) {
        statusPill.classList.add('connected');
    } else {
        statusPill.classList.remove('connected');
    }
}

// Show QR section
function showQRSection() {
    qrSection.style.display = 'flex';
    automationSection.style.display = 'none';
}

// Show automation section
function showAutomationSection() {
    qrSection.style.display = 'none';
    automationSection.style.display = 'block';
}

// Handle file upload
contactFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
        const result = await window.electronAPI.file.parseExcel(file.path);

        if (result.success) {
            contacts = result.data;
            totalContactsEl.textContent = contacts.length;
            sendBtn.disabled = contacts.length === 0;
            showToast(`Loaded ${contacts.length} contacts`, 'success');
        } else {
            showToast('Error loading file: ' + result.error, 'error');
        }
    } catch (error) {
        showToast('Error: ' + error.message, 'error');
    }
});

// Send button click
sendBtn.addEventListener('click', async () => {
    if (isSending) {
        // Stop sending (future feature)
        return;
    }

    const message = messageText.value.trim();
    if (!message) {
        showToast('Please enter a message', 'error');
        return;
    }

    if (contacts.length === 0) {
        showToast('Please upload contacts', 'error');
        return;
    }

    isSending = true;
    sentCount = 0;
    failedCount = 0;

    // Reset UI
    sentCountEl.textContent = '0';
    failedCountEl.textContent = '0';
    progressFill.style.width = '0%';
    progressText.textContent = `0 / ${contacts.length}`;
    liveLog.innerHTML = '';

    sendBtn.textContent = 'Sending...';
    sendBtn.disabled = true;

    const delay = parseInt(delaySelect.value);
    const mediaPath = mediaFile.files[0]?.path || null;

    try {
        await window.electronAPI.whatsapp.sendBulk({
            contacts,
            message,
            mediaPath,
            delay
        });
    } catch (error) {
        showToast('Error: ' + error.message, 'error');
    }

    isSending = false;
    sendBtn.textContent = 'Start Sending';
    sendBtn.disabled = false;
});

// Handle message sent event
function handleMessageSent(data) {
    const { current, total, phone, name, status, error } = data;

    // Update counters
    if (status === 'sent') {
        sentCount++;
        sentCountEl.textContent = sentCount;
    } else {
        failedCount++;
        failedCountEl.textContent = failedCount;
    }

    // Update progress
    const percentage = Math.round((current / total) * 100);
    progressFill.style.width = percentage + '%';
    progressText.textContent = `${current} / ${total}`;

    // Add log entry
    const logItem = document.createElement('div');
    logItem.className = `log-item ${status === 'sent' ? 'success' : 'error'}`;
    logItem.innerHTML = `
        <span class="phone">${phone}</span>
        <span class="name">${name}</span>
        <span class="status-icon">${status === 'sent' ? '✅' : '❌'}</span>
    `;

    // Remove placeholder if exists
    const placeholder = liveLog.querySelector('.log-placeholder');
    if (placeholder) placeholder.remove();

    liveLog.insertBefore(logItem, liveLog.firstChild);

    // Auto-scroll
    liveLog.scrollTop = 0;

    // Check if complete
    if (current === total) {
        showToast(`Complete! Sent: ${sentCount}, Failed: ${failedCount}`, 'success');
    }
}

// Logout
logoutBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to logout?')) {
        await window.electronAPI.license.logout();
    }
});

// Toast
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 4000);
}

// Start
initialize();
