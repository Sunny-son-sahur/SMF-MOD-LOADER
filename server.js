const express = require("express");
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const ADMIN_SECRET = process.env.ADMIN_SECRET || "change-me";
const DB_FILE = path.join(__dirname, "keys.json");

let db = { keys: {} };
if (fs.existsSync(DB_FILE)) {
    try { db = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch(e) {}
}
function save() { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }

function genKey() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const parts = [];
    for (let p = 0; p < 4; p++) {
        let s = "";
        for (let i = 0; i < 5; i++) s += chars[crypto.randomInt(chars.length)];
        parts.push(s);
    }
    return parts.join("-");
}

app.post("/validate", (req, res) => {
    const { key, hwid } = req.body;
    if (!key || !hwid) return res.json({ valid: false, message: "Missing key or hwid" });

    const k = key.toUpperCase().trim();

    if (!db.keys[k]) {
        return res.json({ valid: false, message: "Invalid license key" });
    }

    const entry = db.keys[k];

    if (!entry.hwid) {
        entry.hwid = hwid;
        entry.firstUse = new Date().toISOString();
        save();
        console.log(`[BIND] Key ${k} bound to HWID ${hwid}`);
        return res.json({ valid: true, message: "Key activated and bound to your hardware." });
    }

    if (entry.hwid === hwid) {
        return res.json({ valid: true, message: "Key valid" });
    }

    console.log(`[REJECT] Key ${k} used by different HWID`);
    return res.json({ valid: false, message: "Key is bound to different hardware. Contact support." });
});

app.post("/generate", (req, res) => {
    const { secret, count, keys: manualKeys } = req.body;
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: "Wrong admin secret" });

    const generated = [];

    if (manualKeys && Array.isArray(manualKeys)) {
        for (const k of manualKeys) {
            const normalized = k.toUpperCase().trim();
            if (!db.keys[normalized]) {
                db.keys[normalized] = { hwid: null, created: new Date().toISOString() };
                generated.push(normalized);
            }
        }
    } else {
        const n = Math.min(count || 1, 100);
        for (let i = 0; i < n; i++) {
            let k;
            do { k = genKey(); } while (db.keys[k]);
            db.keys[k] = { hwid: null, created: new Date().toISOString() };
            generated.push(k);
        }
    }

    save();
    console.log(`[GEN] Generated ${generated.length} keys`);
    res.json({ success: true, keys: generated, total: Object.keys(db.keys).length });
});

app.post("/revoke", (req, res) => {
    const { secret, key } = req.body;
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: "Wrong admin secret" });
    const k = key.toUpperCase().trim();
    if (db.keys[k]) { delete db.keys[k]; save(); return res.json({ success: true, message: "Key revoked" }); }
    return res.json({ success: false, message: "Key not found" });
});

app.post("/unbind", (req, res) => {
    const { secret, key } = req.body;
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: "Wrong admin secret" });
    const k = key.toUpperCase().trim();
    if (db.keys[k]) { db.keys[k].hwid = null; save(); return res.json({ success: true, message: "Key unbound" }); }
    return res.json({ success: false, message: "Key not found" });
});

app.get("/status", (req, res) => {
    const total = Object.keys(db.keys).length;
    const bound = Object.values(db.keys).filter(k => k.hwid).length;
    res.json({ total, bound, unbound: total - bound });
});

app.listen(PORT, () => {
    console.log(`[SMF Auth] Running on port ${PORT}`);
});
