# VitaLedger

Decentralized health records on the **Sepolia** testnet.

- **Smart contract** (Hardhat): roles, approvals, access control, record pointers, prescriptions, permanent audit events
- **Backend** (Node + SQLite + bcrypt): passwords, doctor PIN, Pinata proxy, on-chain permission checks
- **Frontend** (React + Vite): Patient, Doctor, Pharmacy, Hospital and Admin dashboards (teal and white, red only for blood and alerts)

## You need
1. Node.js 20 or newer
2. MetaMask with **Sepolia ETH** (free from a Sepolia faucet). Use **throwaway test wallets**.
3. A free **Pinata** account, then API Keys, then New Key, and copy the **JWT**

Use at least 2 to 3 MetaMask accounts for the demo (admin, hospital, doctor, patient, pharmacy can each be a different account).

## Setup
```bash
# 1. Contract
npm install
cp .env.example .env          # add SEPOLIA_RPC_URL and DEPLOYER_PRIVATE_KEY (the admin wallet)
npm test                      # runs the contract tests locally
npm run deploy:sepolia        # writes frontend/src/contract.json and backend/contract.json

# 2. Backend
cd backend && npm install
cp .env.example .env          # set JWT_SECRET, SEPOLIA_RPC_URL, PINATA_JWT
npm start                     # http://localhost:4000

# 3. Frontend (new terminal)
cd frontend && npm install
cp .env.example .env
npm run dev                   # http://localhost:5173
```
The wallet that deploys the contract **is the platform admin**.

## Demo walkthrough
1. **Admin** (deployer wallet): Register, set a name and password, sign in.
2. **Hospital** (account 2): Register as Hospital. Sign in as Admin, open Approvals, approve it.
3. **Doctor** (account 3): Register as Doctor and pick the hospital. Sign in as the hospital and approve the doctor.
4. **Patient** (account 4): Register, add a record (PDF/JPG/PNG), fill in Emergency info.
5. **Doctor**: Find patients, Request access. **Patient**: Doctor access, Approve.
6. **Doctor**: My patients, View records. Enter the PIN (default `12345678`), confirm the on-chain log, open the files. Change the PIN under Security PIN.
7. **Doctor**: issue a prescription. **Pharmacy** (account 5, approved by the hospital or admin): verify and dispense. A second dispense is blocked.
8. **Patient**: Revoke access. The doctor can no longer fetch files. Check Activity, and the Admin audit log.

## How it works
- **Login**: wallet signature (proves ownership) plus password (bcrypt, server side). Your role comes from the contract, not the database.
- **Encryption**: your key is derived from a wallet signature. Files and titles are encrypted in the browser (NaCl secretbox). Only ciphertext goes to IPFS. The on-chain hash is of the ciphertext.
- **Sharing**: on approval, the patient's data key is encrypted to the doctor's public key and stored on-chain. Revoking deletes it.
- **Viewing**: the doctor enters the PIN, then logs the view on-chain. The backend serves files only after both checks, and re-checks access on every request.
- **Hierarchy**: Admin approves hospitals and can override anyone. A hospital approves its own doctors and verifies pharmacies. An admin suspension cannot be undone by a hospital.
- **Recovery**: your keys come from your wallet, so restoring the wallet from its seed phrase restores access. Lose the wallet and seed phrase, and the records cannot be decrypted. That is the privacy trade-off.

## Honest limitations (read before real use)
- **Testnet and demo only.** Not audited, not HIPAA/GDPR compliant. Never upload real patient data.
- **Revocation** stops future file access (the backend refuses) and deletes the on-chain key, but a doctor who already downloaded and decrypted a file keeps that copy. Standard for any system that shows data to a person.
- Record **timestamps, record counts, who accessed whom** are public on-chain (titles and files are encrypted).
- The **doctor's default PIN is 12345678** by design, so change it right after approval.
- `getLogs` from deployment block is used for history. Use a Sepolia RPC without a small range limit (the default public node works).
- The backend holds names, bcrypt hashes, blood group and allergies (emergency info). Run it over HTTPS in any real deployment.
- Pharmacies can see all prescriptions. For production you would limit lookup to a code the patient presents.
- **Not run end to end yet.** The contract tests, backend syntax and file structure were checked, but the project was written offline and not executed. Expect to fix a few small issues on first run.
