import Database from "better-sqlite3";
import bcrypt from "bcryptjs";

const [address, newPassword] = process.argv.slice(2);

if (!address || !newPassword) {
  console.log("Usage: node scripts/reset-password.js <wallet_address> <new_password>");
  process.exit(1);
}

if (newPassword.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const db = new Database("./vitaledger.db");
const addr = address.toLowerCase();
const user = db.prepare("SELECT * FROM accounts WHERE address = ?").get(addr);

if (!user) {
  console.error(`No account found for address: ${address}`);
  process.exit(1);
}

const hash = bcrypt.hashSync(newPassword, 10);
db.prepare("UPDATE accounts SET password_hash = ? WHERE address = ?").run(hash, addr);

console.log(`✓ Password successfully updated for ${user.name} (${user.claimed_role}) [${address}]`);
