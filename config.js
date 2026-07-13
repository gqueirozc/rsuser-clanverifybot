const { MongoClient } = require('mongodb');

const client = new MongoClient(process.env.MONGODB_URI);
let db;

const connect = async () => {
    if (!db) {
        await client.connect();
        db = client.db('clanbot');
    }
    return db;
};

const loadConfig = async () => {
    const database = await connect();
    const docs = await database.collection('config').find({}).toArray();
    const cfg = {};
    for (const doc of docs) {
        const { _id, ...data } = doc;
        cfg[_id] = data;
    }
    return cfg;
};

const saveConfig = async (cfg) => {
    const database = await connect();
    const collection = database.collection('config');
    for (const [gid, data] of Object.entries(cfg)) {
        await collection.replaceOne({ _id: gid }, { _id: gid, ...data }, { upsert: true });
    }
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
    }

    return hasChanges;
};

const deleteGuildConfig = async (gid) => {
    const database = await connect();
    await database.collection('config').deleteOne({ _id: gid });
};

module.exports = {
    loadConfig,
    saveConfig,
    deleteGuildConfig,
    cleanStaleTemp
};