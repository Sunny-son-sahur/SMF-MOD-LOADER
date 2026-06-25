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

    const ADMIN_SECRET = process.env.ADMIN_SECRET || "change-me";
    const { secret, count } = req.body;
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: "Wrong admin secret" });

    loadDB();
    const generated = [];
    const n = Math.min(count || 1, 100);
    for (let i = 0; i < n; i++) {
        let k;
        do { k = genKey(); } while (db.keys[k]);
        db.keys[k] = { hwid: null, created: new Date().toISOString() };
        generated.push(k);
    }

    save();
    res.json({ success: true, keys: generated });
};
