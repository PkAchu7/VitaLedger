import React, { useState } from "react";
import { ethers } from "ethers";
import { Search, Clock, User, Pill, ShieldAlert, KeyRound, ShieldCheck, Check, X, Download, AlertTriangle, FileText, ImageIcon, History } from "lucide-react";
import { api, namesFor, errMsg } from "../lib/api";
import { CONTRACT, readContract, writeContract, short, rxContent } from "../lib/chain";
import { decryptBytes, unwrapKey } from "../lib/crypto";
import { readRecords, saveBlob } from "../lib/files";
import { Shell, PageHeader, EmptyState, StatusPill, Modal, useToast, useLoad, useBusy, Loading } from "../ui";
import AddRecordForm from "./AddRecordForm";
import Audit from "./Audit";

export default function Doctor({ session, onLogout }) {
  const [tab, setTab] = useState("find");
  const [openPatient, setOpenPatient] = useState(null);
  const [toast, notify] = useToast();
  const [busy, run] = useBusy(notify);
  const ctx = { session, notify, busy, run };
  const links = useLoad(async () => {
    const evs = await readContract.queryFilter(readContract.filters.AccessRequested(null, session.address), CONTRACT.deployBlock, "latest");
    const ps = [...new Set(evs.map((e) => e.args.patient.toLowerCase()))];
    const rows = await Promise.all(ps.map(async (p) => ({ address: ethers.getAddress(p), status: Number(await readContract.access(p, session.address)) })));
    const names = await namesFor(session, ps);
    return rows.filter((r) => r.status > 0).map((r) => ({ ...r, name: names[r.address.toLowerCase()] || short(r.address) }));
  }, []);
  const tabs = [
    { key: "find", label: "Find patients", icon: <Search size={17} /> },
    { key: "patients", label: "My patients", icon: <User size={17} /> },
    { key: "rx", label: "Prescriptions", icon: <Pill size={17} /> },
    { key: "glass", label: "Break-glass", icon: <ShieldAlert size={17} /> },
    { key: "activity", label: "My activity", icon: <History size={17} /> },
    { key: "pin", label: "Security PIN", icon: <KeyRound size={17} /> },
  ];
  return (
    <Shell session={session} subtitle={session.hospitalName || "Doctor"} tabs={tabs} tab={tab} setTab={setTab} onLogout={onLogout} toast={toast}>
      {tab === "find" && <Find ctx={ctx} onChange={links.reload} />}
      {tab === "patients" && <Patients ctx={ctx} links={links} onOpen={setOpenPatient} />}
      {tab === "rx" && <Prescribe ctx={ctx} links={links} />}
      {tab === "glass" && <BreakGlass ctx={ctx} />}
      {tab === "activity" && (<><PageHeader title="My activity" subtitle="Everything you've done on-chain. This is what auditors see." />
        <Audit session={session} filter={(r) => r.addrs.includes(session.address.toLowerCase())} /></>)}
      {tab === "pin" && <PinSettings ctx={ctx} />}
      {openPatient && <RecordsModal ctx={ctx} patient={openPatient} onClose={() => setOpenPatient(null)} />}
    </Shell>
  );
}

function PatientSearch({ ctx, action }) {
  const { session, notify } = ctx;
  const [q, setQ] = useState("");
  const [rows, setRows] = useState(null);
  const [searching, setSearching] = useState(false);
  async function go(e) {
    e?.preventDefault();
    if (q.trim().length < 3) return notify("Type at least 3 characters (name or wallet address).", "err");
    setSearching(true);
    try {
      const list = await api(`/directory/patients?q=${encodeURIComponent(q.trim())}`, { token: session.token });
      setRows(await Promise.all(list.map(async (p) => ({ ...p, status: Number(await readContract.access(p.address, session.address)) }))));
    } catch (er) { notify(errMsg(er), "err"); } finally { setSearching(false); }
  }
  return (
    <>
      <form className="vl-inline-form" onSubmit={go}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Patient name or wallet address…" />
        <button className="vl-btn vl-btn--primary" disabled={searching}><Search size={15} /> {searching ? "Searching…" : "Search"}</button>
      </form>
      {rows && (rows.length === 0 ? <p className="vl-muted">No patients found.</p> : (
        <div className="vl-list">{rows.map((p) => (
          <div className="vl-card vl-doctor-row" key={p.address}>
            <div className="vl-doctor-row__info"><div className="vl-avatar vl-avatar--sm">{p.name.charAt(0)}</div>
              <div><h4>{p.name}</h4><div className="vl-muted">{short(p.address)}</div></div></div>
            <div className="vl-doctor-row__actions">{action(p, go)}</div>
          </div>))}</div>))}
    </>
  );
}

function Find({ ctx, onChange }) {
  const { session, run } = ctx;
  return (
    <>
      <PageHeader title="Find patients" subtitle="Request access. The patient sees your verified identity and decides whether to approve." />
      <PatientSearch ctx={ctx} action={(p, refresh) => p.status === 2 ? <StatusPill tone="green"><Check size={12} /> Access active</StatusPill>
        : p.status === 1 ? <StatusPill tone="amber"><Clock size={12} /> Awaiting approval</StatusPill>
        : <button className="vl-btn vl-btn--primary" disabled={ctx.busy} onClick={() => run(async () => { await (await writeContract(session.signer).requestAccess(p.address)).wait(); onChange(); refresh(); }, "Request sent to the patient")}>Request access</button>} />
    </>
  );
}

function Patients({ ctx, links, onOpen }) {
  const { session, run } = ctx;
  const active = (links.data || []).filter((l) => l.status === 2);
  const pending = (links.data || []).filter((l) => l.status === 1);
  return (
    <>
      <PageHeader title="My patients" subtitle="You’ll be asked for your PIN and your wallet logs the view on-chain before any record opens." />
      <Loading state={links}>
        <div className="vl-section">Approved</div>
        {active.length === 0 ? <p className="vl-muted">No approved patients yet.</p> : <div className="vl-list">{active.map((p) => (
          <div className="vl-card vl-doctor-row" key={p.address}>
            <div className="vl-doctor-row__info"><div className="vl-avatar vl-avatar--sm">{p.name.charAt(0)}</div><div><h4>{p.name}</h4><div className="vl-muted">{short(p.address)}</div></div></div>
            <button className="vl-btn vl-btn--primary" onClick={() => onOpen(p)}><ShieldCheck size={15} /> View records</button>
          </div>))}</div>}
        <div className="vl-section">Waiting for the patient</div>
        {pending.length === 0 ? <p className="vl-muted">No pending requests.</p> : <div className="vl-list">{pending.map((p) => (
          <div className="vl-card vl-doctor-row" key={p.address}>
            <div className="vl-doctor-row__info"><div className="vl-avatar vl-avatar--sm">{p.name.charAt(0)}</div><div><h4>{p.name}</h4><StatusPill tone="amber"><Clock size={12} /> Awaiting approval</StatusPill></div></div>
            <button className="vl-btn vl-btn--ghost" disabled={ctx.busy} onClick={() => run(async () => { await (await writeContract(session.signer).withdrawRequest(p.address)).wait(); links.reload(); }, "Request withdrawn")}>Withdraw</button>
          </div>))}</div>}
      </Loading>
    </>
  );
}

function RecordsModal({ ctx, patient, onClose }) {
  const { session, notify } = ctx;
  const [step, setStep] = useState("pin");
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [data, setData] = useState(null);
  const [pinToken, setPinToken] = useState(null);

  async function load(dataKey) {
    const items = readRecords(await readContract.getRecords(patient.address), dataKey);
    setData((d) => ({ ...(d || {}), items, dataKey }));
  }

  async function unlock(e) {
    e.preventDefault(); setErr(""); setStep("loading"); setMsg("Checking your PIN…");
    try {
      const { pinToken: tok } = await api("/doctor/pin/verify", { method: "POST", token: session.token, body: { pin } });
      setPinToken(tok);
      setMsg("Confirm the access log in your wallet…");
      const c = writeContract(session.signer);
      await (await c.logView(patient.address)).wait();
      setMsg("Decrypting records…");
      const dataKey = unwrapKey(await c.getWrappedKey(patient.address), session.keys.box);
      const emergency = await api(`/emergency/${patient.address}`, { token: session.token }).catch(() => null);
      setData({ emergency });
      await load(dataKey);
      setStep("ready");
    } catch (er) { setErr(errMsg(er)); setStep("pin"); }
  }

  async function download(r) {
    try {
      const bytes = await api(`/files/${r.cid}`, { token: session.token, pinToken, raw: true });
      if (ethers.keccak256(bytes) !== r.fileHash) throw new Error("Integrity check failed: file does not match its on-chain hash.");
      saveBlob(decryptBytes(bytes, data.dataKey), r.name || "record", r.mime);
    } catch (er) { notify(errMsg(er), "err"); }
  }

  return (
    <Modal onClose={onClose}>
      <div className="vl-modal__header"><div><h3>{patient.name}</h3><div className="vl-muted">{short(patient.address)}</div></div>
        <button className="vl-icon-btn" onClick={onClose}><X size={18} /></button></div>
      {step === "pin" && (
        <form className="vl-form" onSubmit={unlock}>
          <p className="vl-muted">Enter your 8-digit security PIN. Your wallet will then log this view permanently on-chain.</p>
          <input type="password" inputMode="numeric" maxLength={8} autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder="••••••••" />
          {err && <div className="vl-error">{err}</div>}
          <div className="vl-modal__actions"><button type="button" className="vl-btn vl-btn--ghost" onClick={onClose}>Cancel</button><button className="vl-btn vl-btn--primary">Unlock</button></div>
        </form>)}
      {step === "loading" && <p className="vl-muted" style={{ margin: "24px 0" }}>{msg}</p>}
      {step === "ready" && data && (
        <>
          {data.emergency && (data.emergency.bloodGroup || data.emergency.allergies) && (
            <div className="vl-alert-banner vl-alert-banner--danger"><AlertTriangle size={16} />
              <div><strong>Blood group {data.emergency.bloodGroup || "unknown"}</strong> · Allergies: {data.emergency.allergies || "none recorded"}</div></div>)}
          {data.items.length === 0 ? <p className="vl-muted" style={{ marginTop: 16 }}>No records yet.</p> : (
            <div className="vl-record-grid vl-record-grid--modal">{data.items.map((r) => (
              <div className="vl-card vl-record-card" key={r.id}>
                <div className="vl-record-card__icon">{r.type === "pdf" ? <FileText size={20} /> : <ImageIcon size={20} />}</div>
                <div className="vl-record-card__body"><h4>{r.title}</h4><div className="vl-muted">{new Date(r.createdAt * 1000).toLocaleDateString()}</div>
                  <button className="vl-btn vl-btn--ghost" style={{ marginTop: 8, padding: "6px 10px", fontSize: 12.5 }} onClick={() => download(r)}><Download size={13} /> Open</button></div>
              </div>))}</div>)}
          <div className="vl-section">Add a record to this patient</div>
          <AddRecordForm session={session} patient={patient.address} dataKey={data.dataKey} notify={notify} onDone={() => load(data.dataKey)} />
          <p className="vl-muted vl-modal__footnote"><ShieldCheck size={13} /> This view was logged on-chain. Files stay available for about 10 minutes.</p>
        </>)}
    </Modal>
  );
}

function Prescribe({ ctx, links }) {
  const { session, run } = ctx;
  const approved = (links.data || []).filter((l) => l.status === 2);
  const [patient, setPatient] = useState("");
  const [medicine, setMedicine] = useState("");
  const [dosage, setDosage] = useState("");
  const list = useLoad(() => api("/prescriptions", { token: session.token }), []);
  const target = patient || approved[0]?.address;

  const issue = (e) => {
    e.preventDefault();
    if (!target || !medicine.trim() || !dosage.trim()) return ctx.notify("Choose a patient and fill in the medicine and dosage.", "err");
    run(async () => {
      const nonce = ethers.hexlify(ethers.randomBytes(8));
      const content = rxContent({ patient: target, doctor: session.address, medicine: medicine.trim(), dosage: dosage.trim(), nonce });
      const c = writeContract(session.signer);
      const receipt = await (await c.issuePrescription(target, ethers.id(content))).wait();
      const ev = receipt.logs.map((l) => { try { return c.interface.parseLog(l); } catch { return null; } }).find((p) => p?.name === "PrescriptionIssued");
      if (!ev) throw new Error("Could not find PrescriptionIssued event in transaction receipt.");
      await api("/prescriptions", { method: "POST", token: session.token, body: { id: Number(ev.args.id), patient: target, medicine: medicine.trim(), dosage: dosage.trim(), nonce } });
      setMedicine(""); setDosage(""); list.reload();
    }, "Prescription signed on-chain");
  };

  return (
    <>
      <PageHeader title="Prescriptions" subtitle="Signed by your wallet. A pharmacy can verify it's genuine and can only dispense it once." />
      <form className="vl-card vl-form vl-form--wide" onSubmit={issue} style={{ marginBottom: 24 }}>
        <label>Patient<select value={target || ""} onChange={(e) => setPatient(e.target.value)} disabled={!approved.length}>
          {!approved.length && <option>No approved patients yet</option>}
          {approved.map((p) => <option key={p.address} value={p.address}>{p.name}</option>)}</select></label>
        <label>Medicine<input value={medicine} onChange={(e) => setMedicine(e.target.value)} placeholder="Atorvastatin 10mg" maxLength={120} /></label>
        <label>Dosage & instructions<input value={dosage} onChange={(e) => setDosage(e.target.value)} placeholder="1 tablet at night" maxLength={240} /></label>
        <button className="vl-btn vl-btn--primary vl-btn--block" disabled={ctx.busy || !approved.length}><Pill size={15} /> Sign & issue</button>
      </form>
      <Loading state={list}>
        {list.data && list.data.length > 0 && <div className="vl-list">{list.data.map((rx) => (
          <div className="vl-card vl-doctor-row" key={rx.id}>
            <div className="vl-doctor-row__info"><div className="vl-avatar vl-avatar--sm"><Pill size={15} /></div>
              <div><h4>{rx.medicine}</h4><div className="vl-muted">{rx.dosage}</div><div className="vl-muted">For {rx.patientName || short(rx.patient)}</div></div></div>
            <StatusPill tone={rx.status === "dispensed" ? "green" : "amber"}>{rx.status === "dispensed" ? "Dispensed" : "Active"}</StatusPill>
          </div>))}</div>}
      </Loading>
    </>
  );
}

function BreakGlass({ ctx }) {
  const { session, run } = ctx;
  const [target, setTarget] = useState(null);
  const [info, setInfo] = useState(null);
  const confirm = () => run(async () => {
    await (await writeContract(session.signer).breakGlass(target.address)).wait();
    setInfo(await api(`/emergency/${target.address}`, { token: session.token }));
  });
  const close = () => { setTarget(null); setInfo(null); };
  return (
    <>
      <PageHeader title="Break-glass emergency access" subtitle="For critical patients only. It skips approval, reveals only blood group and allergies, and is permanently logged under your name." />
      <PatientSearch ctx={ctx} action={(p) => <button className="vl-btn vl-btn--danger" onClick={() => setTarget(p)}><ShieldAlert size={15} /> Break glass</button>} />
      {target && (
        <Modal tone="danger" onClose={close}>
          {!info ? (<>
            <ShieldAlert size={22} /><h3>Break glass for {target.name}?</h3>
            <p className="vl-muted">This will be recorded on-chain with your wallet and the time. It cannot be undone or hidden. Use it only in a real emergency.</p>
            <div className="vl-modal__actions"><button className="vl-btn vl-btn--ghost" onClick={close}>Cancel</button>
              <button className="vl-btn vl-btn--danger" disabled={ctx.busy} onClick={confirm}>{ctx.busy ? "Logging on-chain…" : "Confirm & log"}</button></div>
          </>) : (<>
            <div className="vl-modal__header"><h3>Critical info — {info.name}</h3><button className="vl-icon-btn" onClick={close}><X size={18} /></button></div>
            <div className="vl-alert-banner vl-alert-banner--danger"><strong>Blood group:</strong> {info.bloodGroup || "not recorded"}</div>
            <div className="vl-alert-banner vl-alert-banner--danger"><AlertTriangle size={16} /><div><strong>Allergies:</strong> {info.allergies || "none recorded"}</div></div>
            <p className="vl-muted vl-modal__footnote"><ShieldCheck size={13} /> This access is permanently logged on-chain.</p>
          </>)}
        </Modal>)}
    </>
  );
}

function PinSettings({ ctx }) {
  const { session, run } = ctx;
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const digits = (setter) => (e) => setter(e.target.value.replace(/\D/g, ""));
  return (
    <>
      <PageHeader title="Security PIN" subtitle="Asked every time you open a patient's records. The default is 12345678, so please change it." />
      <form className="vl-card vl-form vl-form--wide" onSubmit={(e) => { e.preventDefault(); run(async () => { await api("/doctor/pin", { method: "PUT", token: session.token, body: { currentPin: cur, newPin: next } }); setCur(""); setNext(""); }, "PIN updated"); }}>
        <label>Current PIN<input type="password" inputMode="numeric" maxLength={8} value={cur} onChange={digits(setCur)} /></label>
        <label>New 8-digit PIN<input type="password" inputMode="numeric" maxLength={8} value={next} onChange={digits(setNext)} /></label>
        <button className="vl-btn vl-btn--primary vl-btn--block" disabled={ctx.busy || next.length !== 8 || cur.length !== 8}>Update PIN</button>
      </form>
    </>
  );
}
