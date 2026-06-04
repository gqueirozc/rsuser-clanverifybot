const fs = require('fs');

const loadConfig = () => {
    try {
        return JSON.parse(fs.readFileSync('./config.json', 'utf8'));
    } catch {
        return {};
    }
};

const saveConfig = (d) => {
    try {
        if (Object.keys(d).length === 0) {
            const existing = loadConfig();
            if (Object.keys(existing).length > 0) {
                console.warn('⚠️ Prevented saving empty config over existing data!');
                return;
            }
        }
    } catch (err) {
        console.error('Safeguard check error:', err);
    }
    fs.writeFileSync('./config.json', JSON.stringify(d, null, 2));
};

const CLEANUP_AGE = 1000 * 60 * 60 * 24 * 7; // 7 days

const cleanStaleTemp = (cfg) => {
    let hasChanges = false;
    const now = Date.now();

    for (const gid of Object.keys(cfg)) {
        if (cfg[gid].wizardTemp) {
            for (const uid of Object.keys(cfg[gid].wizardTemp)) {
                const t = cfg[gid].wizardTemp[uid]?.timestamp;
                if (t && now - t > CLEANUP_AGE) {
                    delete cfg[gid].wizardTemp[uid];
                    hasChanges = true;
                }
            }
            if (Object.keys(cfg[gid].wizardTemp).length === 0) {
                delete cfg[gid].wizardTemp;
                hasChanges = true;
            }
        }

        if (cfg[gid].ticketWizardTemp) {
            for (const uid of Object.keys(cfg[gid].ticketWizardTemp)) {
                const t = cfg[gid].ticketWizardTemp[uid]?.timestamp;
                if (t && now - t > CLEANUP_AGE) {
                    delete cfg[gid].ticketWizardTemp[uid];
                    hasChanges = true;
                }
            }
            if (Object.keys(cfg[gid].ticketWizardTemp).length === 0) {
                delete cfg[gid].ticketWizardTemp;
                hasChanges = true;
            }
        }
    }

    return hasChanges;
};

module.exports = {
    loadConfig,
    saveConfig,
    cleanStaleTemp
};