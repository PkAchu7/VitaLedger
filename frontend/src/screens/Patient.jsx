import React, { useState } from "react";
import { ethers } from "ethers";
import { FileText, Upload, ShieldCheck, Pill, User as UserIcon, History, Check, X, Download, ImageIcon, Clock } from "lucide-react";
import { api, namesFor } from "../lib/api";
import { CONTRACT, readContract, writeContract, short } from "../lib/chain";
import { decryptBytes, wrapKey } from "../lib/crypto";
import { readRecords, saveBlob } from "../lib/files";
import { Shell, PageHeader, EmptyState, StatusPill, CABadge, useToast, useLoad, useBusy, Loading } from "../ui";
import AddRecordForm from "./AddRecordForm";
import Audit from "./Audit";

export default function Patient({ session, onLogout }) {
  const [tab, setTab] = useState("records");
  const [toast, notify] = useToast();
  const [busy, run] = useBusy(notify);
  const ctx = { session, notify, busy, run };
  const tabs = [
    { key: "records", label: "My records", icon: <FileText size={17} /> },
    { key: "add", label: "Add record", icon: <Upload size={17} /> },
    { key: "access", label: "Doctor access", icon: <ShieldCheck size={17} /> },
    { key: "rx", label: "Prescriptions", icon: <Pill size={17} /> },
    { key: "profile", label: "Emergency info", icon: <UserIcon size={17} /> },
    { key: "activity", label: "Activity", icon: <History size={17} /> },
  ];
  return (
    <Shell session={session} subtitle={short(session.address)} tabs={tabs} tab={tab} setTab={setTab} onLogout={onLogout} toast={toast}>
      {tab === "records" && <Records ctx={ctx} />}
      {tab === "add" && (<><PageHeader title="Add a record" subtitle="The file is encrypted in your browser before it leaves your device. Only the encrypted copy reaches IPFS." />
        <AddRecordForm session={session} patient={session.address} dataKey={session.keys.dataKey} notify={notify} onDone={() => setTab("records")} /></>)}
      {tab === "access" && <Access ctx={ctx} />}
      {tab === "rx" && <Prescriptions ctx={ctx} />}
      {tab === "profile" && <Profile ctx={ctx} />}
      {tab === "activity" && (<><PageHeader title="Activity" subtitle="Every request, grant, view and break-glass on your records, permanently logged on-chain." />
        <Audit session={session} filter={(r) => r.addrs.includes(session.address.toLowerCase())} /></>)}
    </Shell>
  );
}

function Records({ ctx }) {
  const { session, run } = ctx;
  const state = useLoad(async () => {
    const items = readRecords(await readContract.getRecords(session.address), session.keys.dataKey);
    const names = await namesFor(session, items.map((i) => i.author));
    return { items, names };
  }, []);

  const download = (r) => run(async () => {
    const bytes = await api(`/files/${r.cid}`, { token: session.token, raw: true });
    if (ethers.keccak256(bytes) !== r.fileHash) throw new Error("Integrity check failed: the file does not match its on-chain hash.");
    saveBlob(decryptBytes(bytes, session.keys.dataKey), r.name || "record", r.mime);
  });

  return (
    <>
      <PageHeader title="My records" subtitle="Each file is encrypted, pinned to IPFS and anchored on-chain, so it can't be quietly changed." />
      <Loading state={state}>
        {state.data && (state.data.items.length === 0
          ? <EmptyState icon={<FileText size={28} />} title="No records yet" body="Add your first report or scan from the “Add record” tab." />
          : <div className="vl-record-grid">
              {state.data.items.map((r) => (
                <div className="vl-card vl-record-card" key={r.id}>
                  <div className="vl-record-card__icon">{r.type === "pdf" ? <FileText size={20} /> : <ImageIcon size={20} />}</div>
                  <div className="vl-record-card__body">
                    <h4>{r.title}</h4>
                    <div className="vl-muted">{new Date(r.createdAt * 1000).toLocaleDateString()}{r.author.toLowerCase() !== session.address.toLowerCase() ? ` · by ${state.data.names[r.author.toLowerCase()] || short(r.author)}` : ""}</div>
                    <div className="vl-hash-row"><ShieldCheck size={12} /> {short(r.cid)}</div>
                    <button className="vl-btn vl-btn--ghost" style={{ marginTop: 10, padding: "6px 10px", fontSize: 12.5 }} disabled={ctx.busy} onClick={() => download(r)}><Download size={13} /> Open</button>
                  </div>
                </div>
              ))}
            </div>)}
      </Loading>
    </>
  );
}

function Access({ ctx }) {
  const { session, run } = ctx;
  const state = useLoad(async () => {
    const evs = await readContract.queryFilter(readContract.filters.AccessRequested(session.address), CONTRACT.deployBlock, "latest");
    const docs = [...new Set(evs.map((e) => e.args.doctor.toLowerCase()))];
    const rows = await Promise.all(docs.map(async (d) => ({ address: ethers.getAddress(d), status: Number(await readContract.access(session.address, d)) })));
    const names = await namesFor(session, docs);
    return rows.filter((r) => r.status > 0).map((r) => ({ ...r, name: names[r.address.toLowerCase()] || short(r.address) }));
  }, []);

  const tx = (fn, okMsg) => run(async () => { await (await fn()).wait(); state.reload(); }, okMsg);
  const c = () => writeContract(session.signer);
  const approve = (d) => tx(async () => {
    const u = await readContract.users(d.address);
    return c().grantAccess(d.address, wrapKey(session.keys.dataKey, u.encKey));
  }, "Access granted");

  const pending = (state.data || []).filter((r) => r.status === 1);
  const active = (state.data || []).filter((r) => r.status === 2);
  return (
    <>
      <PageHeader title="Doctor access" subtitle="Nobody can read your records unless you approve them here. Revoking cuts off file access immediately." />
      <Loading state={state}>
        <div className="vl-section">Waiting for your approval</div>
        {pending.length === 0 ? <p className="vl-muted">No pending requests.</p> : (
          <div className="vl-list">{pending.map((d) => (
            <div className="vl-card vl-doctor-row" key={d.address}>
              <div className="vl-doctor-row__info"><div className="vl-avatar vl-avatar--sm">{d.name.charAt(0)}</div>
                <div><h4>{d.name}</h4><div className="vl-muted">{short(d.address)}</div><CABadge /></div></div>
              <div className="vl-doctor-row__actions">
                <button className="vl-btn vl-btn--ghost" disabled={ctx.busy} onClick={() => tx(() => c().denyRequest(d.address), "Request denied")}><X size={15} /> Deny</button>
                <button className="vl-btn vl-btn--primary" disabled={ctx.busy} onClick={() => approve(d)}><Check size={15} /> Approve</button>
              </div>
            </div>))}</div>)}
        <div className="vl-section">Currently have access</div>
        {active.length === 0 ? <p className="vl-muted">No doctor has access right now.</p> : (
          <div className="vl-list">{active.map((d) => (
            <div className="vl-card vl-doctor-row" key={d.address}>
              <div className="vl-doctor-row__info"><div className="vl-avatar vl-avatar--sm">{d.name.charAt(0)}</div>
                <div><h4>{d.name}</h4><div className="vl-muted">{short(d.address)}</div><StatusPill tone="green"><Check size={12} /> Access active</StatusPill></div></div>
              <button className="vl-btn vl-btn--danger" disabled={ctx.busy} onClick={() => tx(() => c().revokeAccess(d.address), "Access revoked")}>Revoke access</button>
            </div>))}</div>)}
      </Loading>
    </>
  );
}

function Prescriptions({ ctx }) {
  const state = useLoad(() => api("/prescriptions", { token: ctx.session.token }), []);
  return (
    <>
      <PageHeader title="Prescriptions" subtitle="Signed on-chain by your doctor. Once a pharmacy dispenses one, it can’t be used again." />
      <Loading state={state}>
        {state.data && (state.data.length === 0 ? <EmptyState icon={<Pill size={28} />} title="No prescriptions yet" body="They’ll show up here when a doctor issues one." />
          : <div className="vl-list">{state.data.map((rx) => (
            <div className="vl-card vl-doctor-row" key={rx.id}>
              <div className="vl-doctor-row__info"><div className="vl-avatar vl-avatar--sm"><Pill size={15} /></div>
                <div><h4>{rx.medicine}</h4><div className="vl-muted">{rx.dosage}</div><div className="vl-muted">From {rx.doctorName || short(rx.doctor)} · {new Date(rx.issuedAt * 1000).toLocaleDateString()}</div></div></div>
              <StatusPill tone={rx.status === "dispensed" ? "green" : "amber"}>{rx.status === "dispensed" ? <Check size={12} /> : <Clock size={12} />}{rx.status === "dispensed" ? "Dispensed" : "Active"}</StatusPill>
            </div>))}</div>)}
      </Loading>
    </>
  );
}

function Profile({ ctx }) {
  const { session, run } = ctx;
  const state = useLoad(() => api("/me", { token: session.token }), []);
  const [bg, setBg] = useState(null);
  const [al, setAl] = useState(null);
  const data = state.data || {};
  return (
    <>
      <PageHeader title="Emergency info" subtitle="Shown to doctors who are viewing your records with your consent, or in a logged break-glass emergency. Nothing else." />
      <Loading state={state}>
        <form className="vl-card vl-form vl-form--wide" onSubmit={(e) => { e.preventDefault(); run(() => api("/me/emergency", { method: "PUT", token: session.token, body: { bloodGroup: bg ?? data.bloodGroup, allergies: al ?? data.allergies } }), "Emergency info saved"); }}>
          <label>Blood group<input maxLength={5} value={bg ?? data.bloodGroup ?? ""} onChange={(e) => setBg(e.target.value)} placeholder="O+" /></label>
          <label>Known allergies<input value={al ?? data.allergies ?? ""} onChange={(e) => setAl(e.target.value)} placeholder="Penicillin, peanuts" /></label>
          <button className="vl-btn vl-btn--primary vl-btn--block" disabled={ctx.busy}>Save</button>
        </form>
      </Loading>
    </>
  );
}
