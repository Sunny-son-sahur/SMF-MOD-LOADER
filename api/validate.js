const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

const DB_FILE = path.join("/tmp", "keys.json");

let db = { keys: {} };
function loadDB() {
    try {
        if (fs.existsSync(DB_FILE)) {
            db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
        }
    } catch(e) { db = { keys: {} }; }
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

module.exports = async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") return res.status(200).end();

    loadDB();
    const { key, hwid } = req.body;
    if (!key || !hwid) return res.json({ valid: false, message: "Missing key or hwid" });

    const k = key.toUpperCase().trim();
    if (!db.keys[k]) return res.json({ valid: false, message: "Invalid license key" });

    const entry = db.keys[k];

    if (!entry.hwid) {
        entry.hwid = hwid;
        entry.firstUse = new Date().toISOString();
        save();
        return res.json({ valid: true, message: "Key activated and bound to your hardware." });
    }

    if (entry.hwid === hwid) {
        return res.json({ valid: true, message: "Key valid" });
    }

    return res.json({ valid: false, message: "Key is bound to different hardware. Contact support." });
};
