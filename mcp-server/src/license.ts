/**
 * License validation module
 * 
 * Validates license keys against the remote API and manages local license cache.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as https from 'https';

const LICENSE_FILE = path.join(process.cwd(), '.license.dat');
const LICENSE_API_URL = process.env.LICENSE_API_URL || 'https://tvxezpnyhgzqtzccdjeu.supabase.co/functions/v1/validate-software-license';

interface LicenseData {
    key: string;
    machineId: string;
    validatedAt: string;
    expiresAt: string;
    features: string[];
}

interface ValidationResult {
    valid: boolean;
    expiresAt?: string;
    features?: string[];
    error?: string;
}

/**
 * Get a unique machine identifier
 */
function getMachineId(): string {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    const macs: string[] = [];

    for (const iface of Object.values(interfaces)) {
        for (const info of iface as any[]) {
            if (info.mac && info.mac !== '00:00:00:00:00:00') {
                macs.push(info.mac);
            }
        }
    }

    const combined = macs.sort().join(':') + os.hostname();
    return crypto.createHash('sha256').update(combined).digest('hex').substring(0, 32);
}

/**
 * Encrypt license data for local storage
 */
function encryptLicense(data: LicenseData): string {
    const key = crypto.scryptSync(getMachineId(), 'n8n-agent-salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt license data from local storage
 */
function decryptLicense(encrypted: string): LicenseData | null {
    try {
        const [ivHex, authTagHex, data] = encrypted.split(':');
        const key = crypto.scryptSync(getMachineId(), 'n8n-agent-salt', 32);
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');

        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(data, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return JSON.parse(decrypted);
    } catch {
        return null;
    }
}

/**
 * Save license to encrypted local file
 */
function saveLicense(data: LicenseData): void {
    const encrypted = encryptLicense(data);
    fs.writeFileSync(LICENSE_FILE, encrypted);
}

/**
 * Load license from encrypted local file
 */
function loadLicense(): LicenseData | null {
    if (!fs.existsSync(LICENSE_FILE)) {
        return null;
    }
    const encrypted = fs.readFileSync(LICENSE_FILE, 'utf8');
    return decryptLicense(encrypted);
}

/**
 * Validate license against remote API
 */
export async function validateLicense(licenseKey: string): Promise<ValidationResult> {
    return new Promise((resolve) => {
        const machineId = getMachineId();
        const postData = JSON.stringify({ key: licenseKey, machineId });

        const url = new URL(LICENSE_API_URL);
        const options = {
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
            },
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    if (response.valid) {
                        // Cache the license locally
                        saveLicense({
                            key: licenseKey,
                            machineId,
                            validatedAt: new Date().toISOString(),
                            expiresAt: response.expiresAt,
                            features: response.features || [],
                        });
                    }
                    resolve(response);
                } catch {
                    resolve({ valid: false, error: 'Invalid API response' });
                }
            });
        });

        req.on('error', (e) => {
            // Try to use cached license if network fails
            const cached = loadLicense();
            if (cached && new Date(cached.expiresAt) > new Date()) {
                resolve({
                    valid: true,
                    expiresAt: cached.expiresAt,
                    features: cached.features,
                });
            } else {
                resolve({ valid: false, error: `Network error: ${e.message}` });
            }
        });

        req.write(postData);
        req.end();
    });
}

/**
 * Check if there's a valid cached license
 */
export function checkCachedLicense(): ValidationResult {
    const cached = loadLicense();
    if (!cached) {
        return { valid: false, error: 'No license found' };
    }

    if (new Date(cached.expiresAt) <= new Date()) {
        return { valid: false, error: 'License expired' };
    }

    return {
        valid: true,
        expiresAt: cached.expiresAt,
        features: cached.features,
    };
}

/**
 * Clear local license cache
 */
export function clearLicense(): void {
    if (fs.existsSync(LICENSE_FILE)) {
        fs.unlinkSync(LICENSE_FILE);
    }
}
