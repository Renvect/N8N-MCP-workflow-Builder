console.log('Renderer script started');

function sanitizeText(text) {
    if (typeof text !== 'string') return '';
    return text.replace(/[\x00-\x1F\x7F]/g, '').substring(0, 500);
}

function sanitizeInput(value, maxLength = 500) {
    if (typeof value !== 'string') return '';
    return value.replace(/[\x00-\x1F\x7F]/g, '').substring(0, maxLength).trim();
}

const elements = {
    n8nUrl: document.getElementById('n8n-url'),
    n8nApiKey: document.getElementById('n8n-api-key'),
    n8nEmail: document.getElementById('n8n-email'),
    n8nPassword: document.getElementById('n8n-password'),
    testConnectionBtn: document.getElementById('test-connection-btn'),
    connectionStatus: document.getElementById('connection-status'),
    saveBtn: document.getElementById('save-btn'),
    serverStatus: document.getElementById('server-status'),
    tabBtns: document.querySelectorAll('.tab-btn'),
    tabContents: document.querySelectorAll('.tab-content'),
    schemaDownloadUrl: document.getElementById('schema-download-url'),
    openSchemaDownloadBtn: document.getElementById('open-schema-download-btn'),
    openSchemaJsonBtn: document.getElementById('open-schema-json-btn'),
    ghostPilotToggle: document.getElementById('ghost-pilot-toggle'),
};

elements.tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
        const tabId = btn.dataset.tab;
        elements.tabBtns.forEach((b) => b.classList.remove('active'));
        elements.tabContents.forEach((c) => c.classList.remove('active'));
        btn.classList.add('active');
        const tab = document.getElementById(`${tabId}-tab`);
        if (tab) tab.classList.add('active');
    });
});

async function loadConfig() {
    try {
        const config = await window.electronAPI.getConfig();
        if (elements.n8nUrl) elements.n8nUrl.value = config.n8nUrl || '';
        if (elements.n8nApiKey) elements.n8nApiKey.value = config.n8nApiKey || '';
        if (elements.n8nEmail) elements.n8nEmail.value = config.n8nEmail || '';
        if (elements.n8nPassword) elements.n8nPassword.value = config.n8nPassword || '';
    } catch (err) {
        console.error('Failed to load config:', err);
    }
}

async function saveConfig() {
    const config = {
        n8nUrl: sanitizeInput(elements.n8nUrl?.value || '', 500),
        n8nApiKey: sanitizeInput(elements.n8nApiKey?.value || '', 2000),
        n8nEmail: sanitizeInput(elements.n8nEmail?.value || '', 100),
        n8nPassword: sanitizeInput(elements.n8nPassword?.value || '', 200),
    };

    try {
        const result = await window.electronAPI.saveConfig(config);
        if (result.success && elements.saveBtn) {
            elements.saveBtn.textContent = 'Saved';
            setTimeout(() => {
                elements.saveBtn.textContent = 'Save Changes';
            }, 1500);
        }
    } catch (err) {
        console.error('Failed to save config:', err);
    }
}

function setConnectButtonRunningState(isRunning) {
    if (!elements.testConnectionBtn) return;
    elements.testConnectionBtn.textContent = isRunning ? 'Disconnect' : 'Connect';
}

async function testConnection() {
    if (!elements.testConnectionBtn || !elements.connectionStatus) return;
    elements.testConnectionBtn.disabled = true;

    try {
        const status = await window.electronAPI.getServerStatus();
        if (status?.running) {
            elements.testConnectionBtn.textContent = 'Disconnecting...';
            const stopped = await window.electronAPI.stopServices();
            if (!stopped?.success) {
                elements.connectionStatus.textContent = `Error: ${sanitizeText(stopped?.error || 'Failed to stop services')}`;
                elements.connectionStatus.className = 'connection-status error';
            } else {
                elements.connectionStatus.textContent = 'Disconnected';
                elements.connectionStatus.className = 'connection-status';
            }
            return;
        }

        elements.testConnectionBtn.textContent = 'Connecting...';
        await saveConfig();
        await window.electronAPI.startServices();
        const result = await window.electronAPI.testN8nConnection();

        if (result.success) {
            elements.connectionStatus.textContent = `Connected! ${sanitizeText(result.version || '')}`;
            elements.connectionStatus.className = 'connection-status success';
        } else {
            elements.connectionStatus.textContent = `Error: ${sanitizeText(result.error || 'Connection failed')}`;
            elements.connectionStatus.className = 'connection-status error';
        }
    } catch {
        elements.connectionStatus.textContent = 'Connection test failed';
        elements.connectionStatus.className = 'connection-status error';
    } finally {
        await updateServerStatus();
        elements.testConnectionBtn.disabled = false;
    }
}

async function updateServerStatus() {
    try {
        const status = await window.electronAPI.getServerStatus();
        const statusDot = elements.serverStatus?.querySelector('.status-dot');
        const statusText = elements.serverStatus?.querySelector('.status-text');
        if (!statusDot || !statusText) return;

        if (status.running) {
            statusDot.className = 'status-dot running';
            statusText.textContent = `Running (PID: ${status.pid})`;
            setConnectButtonRunningState(true);
        } else {
            statusDot.className = 'status-dot stopped';
            statusText.textContent = 'Stopped';
            setConnectButtonRunningState(false);
        }
    } catch {
        // ignore
    }
}

if (elements.saveBtn) elements.saveBtn.addEventListener('click', saveConfig);
if (elements.testConnectionBtn) elements.testConnectionBtn.addEventListener('click', testConnection);

if (elements.ghostPilotToggle) {
    elements.ghostPilotToggle.addEventListener('change', () => {
        window.electronAPI?.toggleGhostPilot?.(elements.ghostPilotToggle.checked);
    });
}

function copyToClipboard(elementId) {
    const element = document.getElementById(elementId);
    if (!element) return;

    const text = element.textContent || '';
    const showCopiedState = () => {
        const button = element.parentElement?.querySelector('.copy-btn');
        if (!button) return;
        const original = button.textContent;
        button.textContent = 'Copied';
        button.classList.add('copied');
        setTimeout(() => {
            button.textContent = original;
            button.classList.remove('copied');
        }, 2000);
    };

    Promise.resolve(navigator?.clipboard?.writeText ? navigator.clipboard.writeText(text) : Promise.reject())
        .then(showCopiedState)
        .catch(async () => {
            try {
                const res = await window.electronAPI?.clipboard?.writeText?.(text);
                if (res?.success) showCopiedState();
            } catch {
                // ignore
            }
        });
}

window.copyToClipboard = copyToClipboard;

function populateSchemaLinks() {
    try {
        const remoteSchemaUrl = 'https://tvxezpnyhgzqtzccdjeu.supabase.co/storage/v1/object/public/node-schemas/schema.json';
        if (elements.schemaDownloadUrl) elements.schemaDownloadUrl.textContent = remoteSchemaUrl;
        if (elements.openSchemaDownloadBtn) {
            elements.openSchemaDownloadBtn.addEventListener('click', () => window.electronAPI.openExternal(remoteSchemaUrl));
        }
        if (elements.openSchemaJsonBtn) {
            elements.openSchemaJsonBtn.addEventListener('click', () => window.electronAPI.openExternal(remoteSchemaUrl));
        }
    } catch {
        if (elements.schemaDownloadUrl) elements.schemaDownloadUrl.textContent = 'Error building schema URL';
    }
}

async function populateMcpConfigs() {
    try {
        const paths = await window.electronAPI.getAppPaths();
        const modeLabel = paths.isPackaged ? 'Production' : 'Development';
        const modeBadgeClass = paths.isPackaged ? 'badge-production' : 'badge-development';
        const config = {
            mcpServers: {
                'n8n-agent': {
                    command: 'node',
                    args: [paths.mcpServerPath],
                    env: { MIDDLEWARE_URL: 'http://localhost:3456' },
                },
            },
        };

        [['cursor', 'cursor-mcp-config'], ['windsurf', 'windsurf-mcp-config'], ['antigravity', 'antigravity-mcp-config']].forEach(([name, id]) => {
            const cfg = document.getElementById(id);
            const badge = document.getElementById(`${name}-mode-badge`);
            if (cfg) cfg.textContent = JSON.stringify(config, null, 2);
            if (badge) {
                badge.textContent = modeLabel;
                badge.className = `mode-badge ${modeBadgeClass}`;
            }
        });
    } catch {
        ['cursor-mcp-config', 'windsurf-mcp-config', 'antigravity-mcp-config'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.textContent = 'Error loading configuration';
        });
    }
}

async function populateStaticContent() {
    try {
        const rules = await window.electronAPI.getStaticContent('rules');
        const rulesEl = document.getElementById('rules-content');
        if (rulesEl) rulesEl.textContent = rules;

        const commands = await window.electronAPI.getStaticContent('commands');
        const commandsEl = document.getElementById('commands-content');
        if (commandsEl) commandsEl.textContent = commands;
    } catch {
        const rulesEl = document.getElementById('rules-content');
        if (rulesEl) rulesEl.textContent = 'Error loading rules.';
        const commandsEl = document.getElementById('commands-content');
        if (commandsEl) commandsEl.textContent = 'Error loading commands.';
    }
}

async function populateSkillsTab() {
    try {
        const paths = await window.electronAPI.getAppPaths();
        const skillsPath = paths.skillsPath ||
            (paths.mcpServerPath.replace(/[\\/]mcp-server[\\/]dist[\\/]server\.js$/, '\\skills') ||
                paths.mcpServerPath.replace(/[\\/]mcp-server[\\/]dist[\\/]server\.js$/, '/skills'));

        const skillsPathEl = document.getElementById('skills-path');
        if (skillsPathEl) skillsPathEl.textContent = skillsPath;

        const openSkillsFolderBtn = document.getElementById('open-skills-folder-btn');
        if (openSkillsFolderBtn) {
            openSkillsFolderBtn.addEventListener('click', () => window.electronAPI.openPath(skillsPath));
        }

        const mainSkillContent = document.getElementById('main-skill-content');
        if (mainSkillContent) {
            try {
                const content = await window.electronAPI.getStaticContent('skills/n8n-middleware-tools');
                mainSkillContent.textContent = content || 'Skill file not found. Please reinstall the middleware.';
            } catch {
                mainSkillContent.textContent = 'Skill file not found. Please reinstall the middleware.';
            }
        }
    } catch {
        const skillsPathEl = document.getElementById('skills-path');
        if (skillsPathEl) skillsPathEl.textContent = 'Error loading skills path';
    }
}

loadConfig();
updateServerStatus();
populateMcpConfigs();
populateStaticContent();
populateSkillsTab();
populateSchemaLinks();

setInterval(updateServerStatus, 5000);
