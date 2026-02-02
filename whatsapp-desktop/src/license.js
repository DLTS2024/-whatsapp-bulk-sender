const axios = require('axios');

class LicenseManager {
    constructor(store) {
        this.store = store;
        this.serverUrl = 'https://wa.dltscloud.co.za'; // Your cPanel server
    }

    async verify(licenseKey) {
        try {
            const response = await axios.post(`${this.serverUrl}/api/verify-desktop-license`, {
                licenseKey: licenseKey,
                machineId: this.getMachineId()
            }, {
                timeout: 10000,
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (response.data.valid) {
                return {
                    valid: true,
                    user: response.data.user,
                    expiresAt: response.data.expiresAt,
                    features: response.data.features || {}
                };
            } else {
                return {
                    valid: false,
                    error: response.data.error || 'Invalid license key'
                };
            }

        } catch (error) {
            // If server unreachable, check cached license
            const cachedLicense = this.store.get('license');
            if (cachedLicense && cachedLicense.key === licenseKey) {
                // Allow offline use for 7 days
                const lastVerified = cachedLicense.lastVerified || 0;
                const daysSinceVerification = (Date.now() - lastVerified) / (1000 * 60 * 60 * 24);

                if (daysSinceVerification < 7) {
                    return {
                        valid: true,
                        user: cachedLicense.user,
                        offline: true
                    };
                }
            }

            return {
                valid: false,
                error: 'Cannot connect to license server'
            };
        }
    }

    async heartbeat(licenseKey) {
        try {
            await axios.post(`${this.serverUrl}/api/desktop-heartbeat`, {
                licenseKey: licenseKey,
                machineId: this.getMachineId()
            }, {
                timeout: 5000
            });

            // Update last verified time
            const license = this.store.get('license');
            if (license) {
                license.lastVerified = Date.now();
                this.store.set('license', license);
            }

        } catch (error) {
            console.error('Heartbeat failed:', error.message);
        }
    }

    getMachineId() {
        const os = require('os');
        const crypto = require('crypto');

        // Create a unique machine identifier
        const info = [
            os.hostname(),
            os.platform(),
            os.arch(),
            os.cpus()[0]?.model || 'unknown'
        ].join('-');

        return crypto.createHash('md5').update(info).digest('hex');
    }
}

module.exports = LicenseManager;
