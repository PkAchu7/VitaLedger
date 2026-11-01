import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import fs from "node:fs";
import { ethers } from "ethers";

const {
  PORT = 4000, JWT_SECRET, SEPOLIA_RPC_URL, PINATA_JWT,
  PINATA_GATEWAY = "https://gateway.pinata.cloud", CORS_ORIGIN = "http://localhost:5173",
} = process.env;

if (!JWT_SECRET || JWT_SECRET.length < 24) { console.error("Set JWT_SECRET (24+ chars) in backend/.env"); process.exit(1); }
if (!SEPOLIA_RPC_URL) { console.error("Set SEPOLIA_RPC_URL in backend/.env"); process.exit(1); }

const info = JSON.parse(fs.readFileSync(new URL("./contract.json", import.meta.url), "utf8"));
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || info.address;
if (CONTRACT_ADDRESS === ethers.ZeroAddress || !info.abi.length) {
  console.error("Deploy the contract first (npm run deploy:sepolia in the project root)."); process.exit(1);
}
const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);
const chain = new ethers.Contract(CONTRACT_ADDRESS, info.abi, provider);

// ------------------------------------------------------------------ database
const db = new Database(process.env.DB_PATH || "vitaledger.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    address TEXT PRIMARY KEY, name TEXT NOT NULL, claimed_role TEXT NOT NULL,
    password_hash TEXT NOT NULL, pin_hash TEXT,
    blood_group TEXT DEFAULT '', allergies TEXT DEFAULT '', created_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS files (cid TEXT PRIMARY KEY, patient TEXT NOT NULL, uploader TEXT NOT NULL, created_at INTEGER);
  CREATE TABLE IF NOT EXISTS prescriptions (id INTEGER PRIMARY KEY, patient TEXT, doctor TEXT, content TEXT, content_hash TEXT);
`);

// ------------------------------------------------------------------- helpers
const lc = (a) => String(a || "").toLowerCase();
const httpErr = (status, message) => Object.assign(new Error(message), { status });
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ROLES = ["none", "patient", "doctor", "pharmacy", "hospital"];
const STATUSES = ["none", "pending", "approved", "suspended"];
const nowSec = () => Math.floor(Date.now() / 1000);
const WINDOW = 600; // seconds a view-log / break-glass stays valid

const rxContent = (o) => JSON.stringify({
  patient: lc(o.patient), doctor: lc(o.doctor), medicine: o.medicine, dosage: o.dosage, nonce: o.nonce,
});

async function chainIdentity(address) {
  if (lc(await chain.admin()) === lc(address)) return { role: "admin", status: "approved", hospital: null };
  const u = await chain.users(address);
  return { role: ROLES[Number(u.role)], status: STATUSES[Number(u.status)], hospital: u.hospital };
}

const nonces = new Map();
function consumeSignature(address, signature) {
  const n = nonces.get(lc(address));
  if (!n || n.exp < Date.now()) throw httpErr(400, "Sign-in request expired. Try again.");
  nonces.delete(lc(address));
  let recovered;
  try { recovered = ethers.verifyMessage(n.message, signature); } catch { throw httpErr(401, "Invalid signature."); }
  if (lc(recovered) !== lc(address)) throw httpErr(401, "Signature does not match this wallet.");
}

function auth(req, res, next) {
  try { req.user = jwt.verify((req.headers.authorization || "").replace("Bearer ", ""), JWT_SECRET); next(); }
  catch { res.status(401).json({ error: "Please sign in again." }); }
}

/** Re-checks the live on-chain role/status on every protected call. */
const needActive = (...roles) => wrap(async (req, res, next) => {
  const id = await chainIdentity(req.user.sub);
  if (!roles.includes(id.role) || id.status !== "approved") throw httpErr(403, `Requires an active ${roles.join(" / ")} account.`);
  if (id.role !== "admin" && !(await chain.isActive(req.user.sub, ROLES.indexOf(id.role)))) {
    throw httpErr(403, "Your account (or your hospital) is not active.");
  }
  req.identity = id; next();
});

function pinValid(req) {
  try {
    const p = jwt.verify(req.headers["x-pin-token"] || "", JWT_SECRET);
    return p.pin === true && p.sub === req.user.sub;
  } catch { return false; }
}

async function pinToPinata(buf) {
  if (!PINATA_JWT) throw httpErr(500, "Pinata is not configured on the server.");
  const fd = new FormData();
  fd.append("file", new Blob([buf]), "record.enc");
  fd.append("pinataMetadata", JSON.stringify({ name: "vitaledger-record" }));
  fd.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));
  const r = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST", headers: { Authorization: `Bearer ${PINATA_JWT}` }, body: fd,
  });
  if (!r.ok) throw httpErr(502, "IPFS upload failed.");
  return (await r.json()).IpfsHash;
}

// ----------------------------------------------------------------------- app
const app = express();
app.use(helmet());
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: "100kb" }));
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false });
const pinLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

app.get("/health", (_req, res) => res.json({ ok: true, contract: CONTRACT_ADDRESS }));

// ---------------------------------------------------------------------- auth
app.get("/auth/nonce/:address", authLimiter, (req, res) => {
  const address = req.params.address;
  if (!ethers.isAddress(address)) throw httpErr(400, "Invalid address.");
  const message = `VitaLedger sign-in\nAddress: ${ethers.getAddress(address)}\nNonce: ${crypto.randomBytes(16).toString("hex")}`;
  nonces.set(lc(address), { message, exp: Date.now() + 5 * 60 * 1000 });
  res.json({ message });
});

app.post("/auth/register", authLimiter, wrap(async (req, res) => {
  const { address, signature, name, password, role, bloodGroup = "", allergies = "" } = req.body || {};
  if (!ethers.isAddress(address)) throw httpErr(400, "Invalid address.");
  if (typeof name !== "string" || name.trim().length < 2 || name.length > 80) throw httpErr(400, "Enter your name (2-80 characters).");
  if (typeof password !== "string" || password.length < 8 || password.length > 128) throw httpErr(400, "Password must be 8-128 characters.");
  if (!["patient", "doctor", "pharmacy", "hospital", "admin"].includes(role)) throw httpErr(400, "Invalid role.");
  consumeSignature(address, signature);
  if (db.prepare("SELECT 1 FROM accounts WHERE address=?").get(lc(address))) throw httpErr(409, "Account already exists.");
  if (role === "admin" && lc(await chain.admin()) !== lc(address)) throw httpErr(403, "This wallet is not the contract admin.");
  db.prepare(`INSERT INTO accounts (address,name,claimed_role,password_hash,pin_hash,blood_group,allergies,created_at)
              VALUES (?,?,?,?,?,?,?,?)`).run(
    lc(address), name.trim(), role, await bcrypt.hash(password, 10),
    role === "doctor" ? await bcrypt.hash("12345678", 10) : null, // default PIN, doctors should change it
    String(bloodGroup).slice(0, 5), String(allergies).slice(0, 300), nowSec());
  res.json({ ok: true });
}));

app.post("/auth/login", authLimiter, wrap(async (req, res) => {
  const { address, signature, password } = req.body || {};
  if (!ethers.isAddress(address)) throw httpErr(400, "Invalid address.");
  consumeSignature(address, signature);
  const acc = db.prepare("SELECT * FROM accounts WHERE address=?").get(lc(address));
  if (!acc || !(await bcrypt.compare(String(password || ""), acc.password_hash))) throw httpErr(401, "Invalid wallet or password.");
  const id = await chainIdentity(address);
  if (id.role === "none") throw httpErr(403, "This wallet is not registered on-chain yet. Finish registration first.");
  const token = jwt.sign({ sub: lc(address), role: id.role }, JWT_SECRET, { expiresIn: "8h" });
  res.json({ token, role: id.role, status: id.status, name: acc.name, address: ethers.getAddress(address), hospital: id.hospital });
}));

// ------------------------------------------------------------------ profiles
app.get("/me", auth, wrap(async (req, res) => {
  const a = db.prepare("SELECT name, blood_group, allergies FROM accounts WHERE address=?").get(req.user.sub);
  res.json({ name: a.name, bloodGroup: a.blood_group, allergies: a.allergies });
}));

app.put("/me/emergency", auth, needActive("patient"), wrap(async (req, res) => {
  const { bloodGroup = "", allergies = "" } = req.body || {};
  db.prepare("UPDATE accounts SET blood_group=?, allergies=? WHERE address=?")
    .run(String(bloodGroup).slice(0, 5), String(allergies).slice(0, 300), req.user.sub);
  res.json({ ok: true });
}));

app.get("/names", auth, wrap(async (req, res) => {
  const list = String(req.query.addresses || "").split(",").map((s) => s.trim().toLowerCase())
    .filter((a) => ethers.isAddress(a)).slice(0, 100);
  if (!list.length) return res.json({});
  const rows = db.prepare(`SELECT address, name FROM accounts WHERE address IN (${list.map(() => "?").join(",")})`).all(...list);
  res.json(Object.fromEntries(rows.map((r) => [r.address, r.name])));
}));

// ----------------------------------------------------------------- directory
app.get("/public/hospitals", wrap(async (_req, res) => {
  const rows = db.prepare("SELECT address, name FROM accounts WHERE claimed_role='hospital'").all();
  const ok = await Promise.all(rows.map((r) => chain.isActive(r.address, 4).catch(() => false)));
  res.json(rows.filter((_, i) => ok[i]).map((r) => ({ address: ethers.getAddress(r.address), name: r.name })));
}));

app.get("/directory/patients", auth, needActive("doctor"), wrap(async (req, res) => {
  const q = lc(req.query.q).trim();
  if (q.length < 3) throw httpErr(400, "Type at least 3 characters.");
  const rows = db.prepare("SELECT address, name FROM accounts WHERE claimed_role='patient' AND (lower(name) LIKE ? OR address LIKE ?) LIMIT 10")
    .all(`%${q}%`, `%${q}%`);
  res.json(rows.map((r) => ({ address: ethers.getAddress(r.address), name: r.name })));
}));

app.get("/applicants", auth, needActive("admin", "hospital"), wrap(async (req, res) => {
  const rows = db.prepare("SELECT address, name, claimed_role FROM accounts WHERE claimed_role IN ('hospital','doctor','pharmacy') ORDER BY created_at DESC LIMIT 300").all();
  const full = await Promise.all(rows.map(async (r) => ({ r, u: await chain.users(r.address) })));
  const isAdmin = req.identity.role === "admin";
  const out = full
    .filter(({ r, u }) => ROLES[Number(u.role)] === r.claimed_role && Number(u.status) > 0)
    .filter(({ r, u }) => isAdmin || r.claimed_role === "pharmacy" || (r.claimed_role === "doctor" && lc(u.hospital) === req.user.sub))
    .map(({ r, u }) => {
      const h = u.hospital !== ethers.ZeroAddress ? db.prepare("SELECT name FROM accounts WHERE address=?").get(lc(u.hospital)) : null;
      return { address: ethers.getAddress(r.address), name: r.name, role: r.claimed_role, status: STATUSES[Number(u.status)], hospital: u.hospital, hospitalName: h?.name || null };
    });
  res.json(out);
}));

// ----------------------------------------------------------------- doctor PIN
app.post("/doctor/pin/verify", pinLimiter, auth, needActive("doctor"), wrap(async (req, res) => {
  const a = db.prepare("SELECT pin_hash FROM accounts WHERE address=?").get(req.user.sub);
  if (!a?.pin_hash || !(await bcrypt.compare(String(req.body?.pin || ""), a.pin_hash))) throw httpErr(401, "Incorrect PIN.");
  res.json({ pinToken: jwt.sign({ sub: req.user.sub, pin: true }, JWT_SECRET, { expiresIn: "10m" }) });
}));

app.put("/doctor/pin", pinLimiter, auth, needActive("doctor"), wrap(async (req, res) => {
  const { currentPin, newPin } = req.body || {};
  if (!/^\d{8}$/.test(String(newPin))) throw httpErr(400, "New PIN must be exactly 8 digits.");
  const a = db.prepare("SELECT pin_hash FROM accounts WHERE address=?").get(req.user.sub);
  if (!(await bcrypt.compare(String(currentPin || ""), a.pin_hash))) throw httpErr(401, "Current PIN is incorrect.");
  db.prepare("UPDATE accounts SET pin_hash=? WHERE address=?").run(await bcrypt.hash(String(newPin), 10), req.user.sub);
  res.json({ ok: true });
}));

// --------------------------------------------------------------------- files
app.post("/files/upload", auth, needActive("patient", "doctor"), upload.single("file"), wrap(async (req, res) => {
  const patient = req.body?.patient;
  if (!ethers.isAddress(patient)) throw httpErr(400, "Invalid patient address.");
  if (!req.file) throw httpErr(400, "No file received.");
  const allowed = req.identity.role === "patient" ? lc(patient) === req.user.sub : await chain.hasAccess(patient, req.user.sub);
  if (!allowed) throw httpErr(403, "You are not allowed to add records for this patient.");
  const cid = await pinToPinata(req.file.buffer);
  db.prepare("INSERT OR IGNORE INTO files (cid, patient, uploader, created_at) VALUES (?,?,?,?)").run(cid, lc(patient), req.user.sub, nowSec());
  res.json({ cid });
}));

app.get("/files/:cid", auth, needActive("patient", "doctor"), wrap(async (req, res) => {
  const row = db.prepare("SELECT patient FROM files WHERE cid=?").get(req.params.cid);
  if (!row) throw httpErr(404, "Unknown file.");
  if (req.identity.role === "patient") {
    if (req.user.sub !== row.patient) throw httpErr(403, "Not your record.");
  } else {
    const doc = req.user.sub;
    if (!(await chain.hasAccess(row.patient, doc))) throw httpErr(403, "Access was revoked or never granted.");
    if (nowSec() - Number(await chain.lastViewed(row.patient, doc)) > WINDOW) throw httpErr(403, "Log this view on-chain first (reopen the records).");
    if (!pinValid(req)) throw httpErr(403, "PIN required.");
  }
  const r = await fetch(`${PINATA_GATEWAY.replace(/\/$/, "")}/ipfs/${encodeURIComponent(req.params.cid)}`);
  if (!r.ok) throw httpErr(502, "Could not fetch the file from IPFS.");
  res.type("application/octet-stream").send(Buffer.from(await r.arrayBuffer()));
}));

// ----------------------------------------------------------------- emergency
app.get("/emergency/:patient", auth, needActive("doctor"), wrap(async (req, res) => {
  const p = req.params.patient, d = req.user.sub;
  if (!ethers.isAddress(p)) throw httpErr(400, "Invalid address.");
  let mode = null;
  if (nowSec() - Number(await chain.lastBreakGlass(p, d)) < WINDOW) mode = "break-glass";
  else if ((await chain.hasAccess(p, d)) && nowSec() - Number(await chain.lastViewed(p, d)) < WINDOW) mode = "consented";
  if (!mode) throw httpErr(403, "No active access or break-glass log for this patient.");
  const a = db.prepare("SELECT name, blood_group, allergies FROM accounts WHERE address=?").get(lc(p));
  res.json({ mode, name: a?.name || "Unknown", bloodGroup: a?.blood_group || "", allergies: a?.allergies || "" });
}));

// ------------------------------------------------------------- prescriptions
app.post("/prescriptions", auth, needActive("doctor"), wrap(async (req, res) => {
  const { id, patient, medicine, dosage, nonce } = req.body || {};
  if (!Number.isInteger(id) || !ethers.isAddress(patient)) throw httpErr(400, "Invalid prescription.");
  if (typeof medicine !== "string" || !medicine.trim() || medicine.length > 120) throw httpErr(400, "Invalid medicine.");
  if (typeof dosage !== "string" || !dosage.trim() || dosage.length > 240) throw httpErr(400, "Invalid dosage.");
  if (!/^0x[0-9a-f]{8,32}$/i.test(String(nonce))) throw httpErr(400, "Invalid nonce.");
  let rx;
  try {
    rx = await chain.getPrescription(id);
  } catch {
    throw httpErr(400, "Prescription not found on-chain. Please verify the transaction was confirmed.");
  }
  if (lc(rx.doctor) !== req.user.sub || lc(rx.patient) !== lc(patient)) throw httpErr(403, "This prescription was not issued by you.");
  const content = rxContent({ patient, doctor: req.user.sub, medicine, dosage, nonce });
  if (ethers.id(content) !== rx.contentHash) throw httpErr(400, "Content does not match the on-chain hash.");
  db.prepare("INSERT OR REPLACE INTO prescriptions (id, patient, doctor, content, content_hash) VALUES (?,?,?,?,?)")
    .run(id, lc(patient), req.user.sub, content, rx.contentHash);
  res.json({ ok: true });
}));

app.get("/prescriptions", auth, needActive("patient", "doctor", "pharmacy"), wrap(async (req, res) => {
  const role = req.identity.role, me = req.user.sub;
  const rows = role === "patient" ? db.prepare("SELECT * FROM prescriptions WHERE patient=? ORDER BY id DESC LIMIT 200").all(me)
    : role === "doctor" ? db.prepare("SELECT * FROM prescriptions WHERE doctor=? ORDER BY id DESC LIMIT 200").all(me)
    : db.prepare("SELECT * FROM prescriptions ORDER BY id DESC LIMIT 200").all();
  const nameOf = (a) => db.prepare("SELECT name FROM accounts WHERE address=?").get(a)?.name || null;
  const results = await Promise.all(rows.map(async (r) => {
    try {
      const rx = await chain.getPrescription(r.id);
      const c = JSON.parse(r.content);
      return {
        id: r.id, patient: ethers.getAddress(r.patient), patientName: nameOf(r.patient),
        doctor: ethers.getAddress(r.doctor), doctorName: nameOf(r.doctor),
        medicine: c.medicine, dosage: c.dosage,
        status: Number(rx.status) === 1 ? "dispensed" : "active",
        issuedAt: Number(rx.issuedAt), dispensedAt: Number(rx.dispensedAt),
        verified: ethers.id(r.content) === rx.contentHash && lc(rx.patient) === r.patient && lc(rx.doctor) === r.doctor,
      };
    } catch {
      return null;
    }
  }));
  res.json(results.filter(Boolean));
}));

// --------------------------------------------------------------------- errors
app.use((err, _req, res, _next) => {
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : "Server error." });
});

app.listen(PORT, () => console.log(`VitaLedger API on :${PORT}, contract ${CONTRACT_ADDRESS}`));
