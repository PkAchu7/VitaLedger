import React, { useState } from "react";
import { Users, History, Check, Ban, RotateCcw, Building2 } from "lucide-react";
import { api } from "../lib/api";
import { writeContract, short } from "../lib/chain";
import { Shell, PageHeader, EmptyState, StatusPill, CABadge, useToast, useLoad, useBusy, Loading } from "../ui";
import Audit from "./Audit";

const TONE = { approved: "green", pending: "amber", suspended: "red" };
const LABEL = { hospital: "Hospitals", doctor: "Doctors", pharmacy: "Pharmacies" };

/** Used by both the platform admin and a hospital. The contract enforces what each is allowed to do. */
export default function Org({ session, onLogout }) {
  const isAdmin = session.role === "admin";
  const [tab, setTab] = useState("manage");
  const [toast, notify] = useToast();
  const [busy, run] = useBusy(notify);
  const list = useLoad(() => api("/applicants", { token: session.token }), []);

  const act = (fn, addr, ok) => run(async () => { await (await writeContract(session.signer)[fn](addr)).wait(); list.reload(); }, ok);
  const mine = new Set([session.address.toLowerCase(), ...(list.data || []).map((x) => x.address.toLowerCase())]);

  const tabs = [
    { key: "manage", label: isAdmin ? "Approvals" : "Doctors & pharmacies", icon: <Users size={17} /> },
    { key: "audit", label: "Audit log", icon: <History size={17} /> },
  ];
  const groups = ["hospital", "doctor", "pharmacy"].filter((g) => isAdmin || g !== "hospital");

  return (
    <Shell session={session} subtitle={isAdmin ? "Platform admin" : "Hospital"} tabs={tabs} tab={tab} setTab={setTab} onLogout={onLogout} toast={toast}>
      {tab === "manage" && (
        <>
          <PageHeader title={isAdmin ? "Approvals" : "Doctors & pharmacies"}
            subtitle={isAdmin ? "Verify hospitals, and override or remove any doctor or pharmacy. An admin suspension can't be undone by a hospital."
              : "Approve doctors who joined under your hospital, and verify pharmacies. Suspending a doctor takes effect immediately."} />
          <Loading state={list}>
            {groups.map((g) => {
              const rows = (list.data || []).filter((r) => r.role === g);
              return (
                <div key={g}>
                  <div className="vl-section">{LABEL[g]}</div>
                  {rows.length === 0 ? <p className="vl-muted">None yet.</p> : (
                    <div className="vl-list">{rows.map((r) => (
                      <div className="vl-card vl-doctor-row" key={r.address}>
                        <div className="vl-doctor-row__info"><div className="vl-avatar vl-avatar--sm">{r.name.charAt(0).toUpperCase()}</div>
                          <div><h4>{r.name}</h4><div className="vl-muted">{short(r.address)}{r.hospitalName ? ` · ${r.hospitalName}` : ""}</div>
                            <StatusPill tone={TONE[r.status]}>{r.status === "approved" ? <Check size={12} /> : r.status === "suspended" ? <Ban size={12} /> : null}{r.status}</StatusPill></div></div>
                        <div className="vl-doctor-row__actions">
                          {r.status !== "approved" && <button className="vl-btn vl-btn--primary" disabled={busy} onClick={() => act("approve", r.address, `${r.name} approved`)}>{r.status === "suspended" ? <><RotateCcw size={14} /> Reactivate</> : <><Check size={14} /> Approve</>}</button>}
                          {r.status !== "suspended" && <button className="vl-btn vl-btn--danger" disabled={busy} onClick={() => act("suspend", r.address, `${r.name} suspended`)}><Ban size={14} /> {r.status === "pending" ? "Reject" : "Suspend"}</button>}
                        </div>
                      </div>))}</div>)}
                </div>);
            })}
          </Loading>
        </>)}
      {tab === "audit" && (
        <>
          <PageHeader title="Audit log" subtitle={isAdmin ? "Every event across the network, permanently on-chain." : "Every event involving your hospital and your doctors, permanently on-chain."} />
          {list.loading && !list.data ? <p className="vl-muted">Loading…</p>
            : <Audit session={session} filter={isAdmin ? () => true : (r) => r.addrs.some((a) => mine.has(a))} />}
        </>)}
    </Shell>
  );
}
