// WhatsApp Bulk Sender - Frontend JavaScript

// Auth Check
const token = localStorage.getItem('token');
const user = JSON.parse(localStorage.getItem('user') || 'null');

// Check if user is logged in
if (!token || !user) {
    window.location.href = '/login.html';
}

// Check if license is valid
if (!user.is_admin && !user.license_key) {
    window.location.href = '/activate.html';
}

// Check license expiry
if (!user.is_admin && user.license_expires_at) {
    const expiryDate = new Date(user.license_expires_at);
    if (expiryDate < new Date()) {
        alert('Your license has expired! Please renew to continue.');
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login.html';
    }
}

// Display user info
document.addEventListener('DOMContentLoaded', () => {
    const userInfoEl = document.getElementById('userInfo');
    const userNameEl = document.getElementById('userName');
    const licenseBadgeEl = document.getElementById('licenseBadge');
    const adminBtnEl = document.getElementById('adminBtn');

    if (userInfoEl && user) {
        userNameEl.textContent = user.name || user.email;

        if (user.is_admin) {
            licenseBadgeEl.textContent = 'Admin';
            licenseBadgeEl.style.background = '#ff9500';
            adminBtnEl.style.display = 'flex';
        } else if (user.license_expires_at) {
            const days = Math.ceil((new Date(user.license_expires_at) - new Date()) / (1000 * 60 * 60 * 24));
            licenseBadgeEl.textContent = `${days} days left`;
            licenseBadgeEl.style.background = days < 30 ? '#ea4335' : '#25D366';
        }

        userInfoEl.style.display = 'flex';
    }
});

// HTTP Polling (cPanel compatible - no WebSocket needed)
let pollingInterval = null;
let lastQR = null;
let wasConnected = false;

// State
let contacts = [];
let templates = [];
let editingTemplateId = null;
let mediaPath = null;

// DOM Elements
const qrSection = document.getElementById('qrSection');
const automationSection = document.getElementById('automationSection');
const statusPill = document.getElementById('statusPill');

// HTTP Polling for WhatsApp status
async function pollStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();

        if (data.connected) {
            if (!wasConnected) {
                wasConnected = true;
                updateStatus(true, 'Connected');
                showAutomationSection();
                loadStats();
                loadTemplatesForSelect();
            }
        } else if (data.hasQR) {
            wasConnected = false;
            // Fetch QR code
            const qrRes = await fetch('/api/qr');
            const qrData = await qrRes.json();
            if (qrData.qr && qrData.qr !== lastQR) {
                lastQR = qrData.qr;
                document.getElementById('qrCode').src = qrData.qr;
                document.getElementById('qrCode').style.display = 'block';
                document.getElementById('qrSpinner').style.display = 'none';
                updateStatus(false, 'Scan QR Code');
                showQRSection();
            }
        } else {
            wasConnected = false;
            updateStatus(false, 'Connecting...');
            showQRSection();
        }
    } catch (err) {
        console.error('Poll error:', err);
    }
}

// Start polling every 3 seconds
pollingInterval = setInterval(pollStatus, 3000);
pollStatus(); // Initial call

function updateStatus(connected, message) {
    statusPill.className = 'status-pill' + (connected ? ' connected' : '');
    statusPill.querySelector('span').textContent = message;
}

function showQRSection() {
    qrSection.style.display = 'flex';
    automationSection.style.display = 'none';
}

function showAutomationSection() {
    qrSection.style.display = 'none';
    automationSection.style.display = 'block';
}

// Logout
async function logout() {
    if (!confirm('Logout from your account?')) return;

    // Clear auth data
    localStorage.removeItem('token');
    localStorage.removeItem('user');

    // Disconnect WhatsApp if connected
    try {
        await fetch('/api/logout', { method: 'POST' });
    } catch (err) { }

    // Redirect to login
    window.location.href = '/login.html';
}

// Tabs
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`${tab.dataset.tab}-tab`).classList.add('active');

        if (tab.dataset.tab === 'templates') loadTemplates();
        if (tab.dataset.tab === 'logs') loadLogs();
    });
});

// Templates
async function loadTemplates() {
    const list = document.getElementById('templatesList');
    try {
        const res = await fetch('/api/templates');
        templates = await res.json();
        if (templates.length === 0) {
            list.innerHTML = '<div class="empty-msg">No templates yet. Create one!</div>';
            return;
        }
        list.innerHTML = templates.map(t => `
            <div class="item-card">
                <h4>${escapeHtml(t.name)}</h4>
                <p>${escapeHtml(t.message.substring(0, 80))}${t.message.length > 80 ? '...' : ''}</p>
                <button class="edit-btn" onclick="editTemplate(${t.id})">Edit</button>
                <button class="delete-btn" onclick="deleteTemplate(${t.id})">Delete</button>
            </div>
        `).join('');
    } catch (err) {
        list.innerHTML = '<div class="empty-msg">Error loading</div>';
    }
}

async function loadTemplatesForSelect() {
    try {
        const res = await fetch('/api/templates');
        templates = await res.json();
        const select = document.getElementById('templateSelect');
        select.innerHTML = '<option value="">Choose template...</option>' +
            templates.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
    } catch (err) { }
}

function onTemplateSelect() {
    const select = document.getElementById('templateSelect');
    const template = templates.find(t => t.id == select.value);
    if (template) document.getElementById('customMessage').value = template.message;
    updateSendButton();
}

function showTemplateModal(template = null) {
    editingTemplateId = template?.id || null;
    document.getElementById('modalTitle').textContent = template ? 'Edit Template' : 'New Template';
    document.getElementById('templateName').value = template?.name || '';
    document.getElementById('templateMessage').value = template?.message || '';
    document.getElementById('templateModal').classList.add('active');
}

function closeTemplateModal() {
    document.getElementById('templateModal').classList.remove('active');
}

async function saveTemplate() {
    const name = document.getElementById('templateName').value.trim();
    const message = document.getElementById('templateMessage').value.trim();
    if (!name || !message) return showToast('Fill all fields', 'error');

    try {
        await fetch(editingTemplateId ? `/api/templates/${editingTemplateId}` : '/api/templates', {
            method: editingTemplateId ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, message })
        });
        closeTemplateModal();
        loadTemplates();
        loadTemplatesForSelect();
        showToast('Saved!');
    } catch (err) {
        showToast('Error', 'error');
    }
}

function editTemplate(id) {
    showTemplateModal(templates.find(t => t.id === id));
}

async function deleteTemplate(id) {
    if (!confirm('Delete this template?')) return;
    await fetch(`/api/templates/${id}`, { method: 'DELETE' });
    loadTemplates();
    showToast('Deleted');
}

// Media Upload
async function handleMediaUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('media', file);

    try {
        const res = await fetch('/api/upload-media', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.error) return showToast(data.error, 'error');

        mediaPath = data.filePath;
        document.getElementById('mediaFileName').textContent = '📎 ' + data.fileName;
        document.getElementById('mediaPreview').style.display = 'flex';
        showToast('Media attached');
    } catch (err) {
        showToast('Upload failed', 'error');
    }
}

function clearMedia() {
    mediaPath = null;
    document.getElementById('mediaFile').value = '';
    document.getElementById('mediaPreview').style.display = 'none';
}

// Excel Upload
async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await fetch('/api/upload-excel', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.error) return showToast(data.error, 'error');

        contacts = data.contacts;
        document.getElementById('phoneCount').textContent = contacts.length;
        document.getElementById('contactsPreview').style.display = 'flex';
        updateSendButton();
        showToast(`${contacts.length} contacts loaded`);
    } catch (err) {
        showToast('Upload failed', 'error');
    }
}

function clearPhoneNumbers() {
    contacts = [];
    document.getElementById('excelFile').value = '';
    document.getElementById('contactsPreview').style.display = 'none';
    updateSendButton();
}

// Send Messages
function updateSendButton() {
    const message = document.getElementById('customMessage').value.trim();
    document.getElementById('sendBtn').disabled = !(message && contacts.length > 0);
}

async function startSending() {
    const message = document.getElementById('customMessage').value.trim();
    if (!message || contacts.length === 0) return;

    document.getElementById('progressBox').style.display = 'block';
    document.getElementById('liveLog').innerHTML = '';
    document.getElementById('sendBtn').disabled = true;

    try {
        await fetch('/api/send-messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contacts, message, mediaPath })
        });
    } catch (err) {
        showToast('Error starting', 'error');
        document.getElementById('sendBtn').disabled = false;
    }
}

function updateProgress(current, total) {
    const percent = Math.round((current / total) * 100);
    document.getElementById('progressFill').style.width = percent + '%';
    document.getElementById('progressText').textContent = `${current}/${total}`;
    document.getElementById('progressPercent').textContent = percent + '%';
}

function addLiveLog(phone, name, status, error) {
    const log = document.getElementById('liveLog');
    const entry = document.createElement('div');
    entry.className = 'log-entry ' + status;
    entry.textContent = `${phone}${name ? ' (' + name + ')' : ''} - ${status}`;
    log.insertBefore(entry, log.firstChild);
}

// Logs
async function loadLogs() {
    const list = document.getElementById('logsList');
    try {
        const res = await fetch('/api/logs');
        const logs = await res.json();
        if (logs.length === 0) {
            list.innerHTML = '<div class="empty-msg">No logs yet</div>';
            return;
        }
        list.innerHTML = logs.slice(0, 50).map(log => `
            <div class="item-card">
                <h4>${log.phone_number}</h4>
                <p>${escapeHtml((log.message_text || '').substring(0, 50))}...</p>
                <span class="status-badge ${log.status}">${log.status}</span>
            </div>
        `).join('');
    } catch (err) {
        list.innerHTML = '<div class="empty-msg">Error loading</div>';
    }
}

// Stats
async function loadStats() {
    try {
        const res = await fetch('/api/stats');
        const stats = await res.json();
        document.getElementById('totalSent').textContent = stats.total || 0;
        document.getElementById('successCount').textContent = stats.sent || 0;
        document.getElementById('failedCount').textContent = stats.failed || 0;
    } catch (err) { }
}

// Toast
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Message input listener
document.getElementById('customMessage')?.addEventListener('input', updateSendButton);

// Initial load
loadStats();
