import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { Wallet, ShieldCheck, Lock, Clock, User, Stethoscope, Pill, Building2 } from "lucide-react";
import { api, errMsg } from "../lib/api";
import { connectWallet, readContract, writeContract, readProvider, ensureNetwork, CONTRACT, short } from "../lib/chain";
import { deriveKeys, pubKeyHex } from "../lib/crypto";
import { buildSession } from "../lib/session";
import { BrandMark } from "../ui";

const ROLES = {
  patient: { label: "Patient", icon: <User size={16} /> },
  doctor: { label: "Doctor", icon: <Stethoscope size={16} /> },
  pharmacy: { label: "Pharmacy", icon: <Pill size={16} /> },
  hospital: { label: "Hospital", icon: <Building2 size={16} /> },
};

export default function Auth({ onSession }) {
  const [mode, setMode] = useState("login");
  const [wallet, setWallet] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [role, setRole] = useState("patient");
  const [f, setF] = useState({ name: "", password: "", hospital: "", bloodGroup: "", allergies: "" });
  const [hospitals, setHospitals] = useState([]);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  useEffect(() => { api("/public/hospitals").then(setHospitals).catch(() => {}); }, []);
  useEffect(() => {
    if (!window.ethereum?.on) return;
    const handleAccounts = (accs) => {
      if (!accs || accs.length === 0) setWallet(null);
      else connect(false);
    };
    const handleChain = () => {
      connect(false);
    };
    window.ethereum.on("accountsChanged", handleAccounts);
    window.ethereum.on("chainChanged", handleChain);
    return () => {
      window.ethereum.removeListener?.("accountsChanged", handleAccounts);
      window.ethereum.removeListener?.("chainChanged", handleChain);
    };
  }, []);

  async function connect(promptSelect = false) {
    setErr("");
    try {
      const w = await connectWallet({ promptSelect });
      setWallet(w);
      const code = await readProvider.getCode(CONTRACT.address);
      if (!code || code === "0x") {
        throw new Error(`Contract not deployed at ${CONTRACT.address} on this network. Please deploy it first.`);
      }
      setIsAdmin((await readContract.admin()).toLowerCase() === w.address.toLowerCase());
    } catch (e) { setErr(errMsg(e)); }
  }

  async function signNonce() {
    const { message } = await api(`/auth/nonce/${wallet.address}`);
    return wallet.signer.signMessage(message);
  }

  async function login(e) {
    e.preventDefault(); setErr(""); setInfo(""); setBusy("Signing in…");
    try {
      const signature = await signNonce();
      const res = await api("/auth/login", { method: "POST", body: { address: wallet.address, signature, password: f.password } });
      setBusy("Unlocking your encryption keys…");
      onSession({ ...(await buildSession(res, wallet.signer)), token: res.token });
    } catch (er) { setErr(errMsg(er)); } finally { setBusy(""); }
  }

  async function register(e) {
    e.preventDefault(); setErr(""); setInfo("");
    if (f.name.trim().length < 2) return setErr("Enter your name.");
    if (f.password.length < 8) return setErr("Password must be at least 8 characters.");
    if (!isAdmin && role === "doctor" && (!f.hospital || !ethers.isAddress(f.hospital))) return setErr("Please choose a verified hospital.");
    setBusy("Verifying network…");
    try {
      await ensureNetwork(wallet.signer);

      const code = await readProvider.getCode(CONTRACT.address);
      if (!code || code === "0x") {
        throw new Error(`Contract not deployed at ${CONTRACT.address} on this network. Please deploy it first.`);
      }
      setBusy("Registering…");
      const signature = await signNonce();
      try {
        await api("/auth/register", { method: "POST", body: {
          address: wallet.address, signature, name: f.name.trim(), password: f.password,
          role: isAdmin ? "admin" : role, bloodGroup: f.bloodGroup, allergies: f.allergies,
        } });
      } catch (er) { if (er.status !== 409) throw er; }
      if (!isAdmin && Number((await readContract.users(wallet.address)).role) === 0) {
        setBusy("Creating your encryption key (sign in your wallet)…");
        const enc = pubKeyHex((await deriveKeys(wallet.signer)).box);
        await ensureNetwork(wallet.signer);
        const c = writeContract(wallet.signer);
        setBusy("Confirm the transaction in your wallet (Sepolia)…");
        const tx = role === "patient" ? await c.registerPatient(enc)
          : role === "doctor" ? await c.applyDoctor(f.hospital, enc)
          : role === "pharmacy" ? await c.applyPharmacy(enc) : await c.applyHospital(enc);
        setBusy("Waiting for Sepolia to confirm…");
        await tx.wait();
      }
      setInfo(!isAdmin && role !== "patient"
        ? "Application submitted on-chain. Sign in to check your approval status."
        : "Registered. You can sign in now.");
      setMode("login");
    } catch (er) { setErr(errMsg(er)); } finally { setBusy(""); }
  }

  return (
    <div className="vl-login">
      <div className="vl-login__brand">
        <div className="vl-brand-mark"><BrandMark /><span>VITalLedger</span></div>
        <h1>Your medical history, held by no one but you.</h1>
        <p>Records are encrypted in your browser, stored on IPFS and permissioned on the Sepolia blockchain. Every view leaves a permanent timestamp.</p>
        <ul className="vl-login__points">
          <li><ShieldCheck size={18} /> Records can’t be quietly altered</li>
          <li><Lock size={18} /> Nothing is readable without your consent</li>
          <li><Clock size={18} /> Every access is logged for good</li>
        </ul>
      </div>
      <div className="vl-login__panel">
        <div className="vl-login__card">
          <div className="vl-role-toggle" style={{ display: "flex" }}>
            <button type="button" className={mode === "login" ? "is-active" : ""} style={{ flex: 1 }} onClick={() => setMode("login")}>Sign in</button>
            <button type="button" className={mode === "register" ? "is-active" : ""} style={{ flex: 1 }} onClick={() => setMode("register")}>Register</button>
          </div>

          <h2>{mode === "login" ? "Welcome back" : "Create your account"}</h2>
          <p className="vl-muted">{mode === "login" ? "Connect your wallet, then enter your password." : isAdmin ? "This is the admin wallet. Just set a name and password." : "Pick your role. Doctors, pharmacies and hospitals need approval."}</p>

          {!wallet ? (
            <div>
              <button className="vl-btn vl-btn--primary vl-btn--block" style={{ marginTop: 18 }} onClick={() => connect(false)}>
                <Wallet size={16} /> Connect MetaMask (Sepolia)
              </button>
              <div style={{ textAlign: "center", marginTop: 8 }}>
                <button type="button" className="vl-btn vl-btn--ghost" style={{ padding: "5px 12px", fontSize: 12.5 }} onClick={() => connect(true)}>
                  Select / Switch account
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 14 }}>
              <p className="vl-note" style={{ margin: 0, flex: 1 }}>
                <Wallet size={13} style={{ verticalAlign: "-2px" }} /> Connected: {short(wallet.address)}{isAdmin ? " · admin wallet" : ""}
              </p>
              <button
                type="button"
                className="vl-btn vl-btn--ghost"
                style={{ padding: "6px 12px", fontSize: 13, whiteSpace: "nowrap" }}
                onClick={() => connect(true)}
                title="Choose a different MetaMask account"
              >
                Switch account
              </button>
            </div>
          )}

          {wallet && mode === "register" && !isAdmin && (
            <div className="vl-role-toggle vl-role-toggle--quad" style={{ marginTop: 14, marginBottom: 0 }}>
              {Object.entries(ROLES).map(([k, m]) => (
                <button key={k} type="button" className={role === k ? "is-active" : ""} onClick={() => setRole(k)}>{m.icon} {m.label}</button>
              ))}
            </div>
          )}

          {wallet && (
            <form className="vl-form" onSubmit={mode === "login" ? login : register}>
              {mode === "register" && (
                <label>{role === "hospital" ? "Hospital name" : role === "pharmacy" ? "Pharmacy name" : "Full name"}
                  <input value={f.name} onChange={set("name")} placeholder={role === "doctor" ? "Dr. Kabir Sen" : ""} />
                </label>
              )}
              {mode === "register" && !isAdmin && role === "doctor" && (
                <label>Your hospital
                  <select value={f.hospital} onChange={set("hospital")}>
                    <option value="">Select a verified hospital…</option>
                    {hospitals.map((h) => <option key={h.address} value={h.address}>{h.name}</option>)}
                  </select>
                </label>
              )}
              {mode === "register" && !isAdmin && role === "patient" && (
                <>
                  <label>Blood group (optional)<input value={f.bloodGroup} onChange={set("bloodGroup")} placeholder="O+" maxLength={5} /></label>
                  <label>Known allergies (optional)<input value={f.allergies} onChange={set("allergies")} placeholder="Penicillin, peanuts" /></label>
                </>
              )}
              <label>Password<input type="password" value={f.password} onChange={set("password")} placeholder="At least 8 characters" /></label>
              {err && <div className="vl-error">{err}</div>}
              {info && <div className="vl-note">{info}</div>}
              <button className="vl-btn vl-btn--primary vl-btn--block" disabled={!!busy}>{busy || (mode === "login" ? "Sign in" : "Register")}</button>
            </form>
          )}
          {!wallet && err && <div className="vl-error" style={{ marginTop: 14 }}>{err}</div>}
          {!wallet && info && <div className="vl-note">{info}</div>}
          {mode === "register" && wallet && role === "patient" && !isAdmin && (
            <p className="vl-hint">Your encryption key comes from your wallet. Keep your wallet’s seed phrase safe: it is the only way to recover your records. We never see it.</p>
          )}
        </div>
      </div>
    </div>
  );
}
