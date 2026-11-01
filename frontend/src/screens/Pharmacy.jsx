import React, { useState } from "react";
import { Pill, Search, Check, AlertTriangle } from "lucide-react";
import { api } from "../lib/api";
import { writeContract, short } from "../lib/chain";
import { Shell, PageHeader, EmptyState, StatusPill, CABadge, useToast, useLoad, useBusy, Loading } from "../ui";

export default function Pharmacy({ session, onLogout }) {
  const [toast, notify] = useToast();
  const [busy, run] = useBusy(notify);
  const [q, setQ] = useState("");
  const state = useLoad(() => api("/prescriptions", { token: session.token }), []);
  const rows = (state.data || []).filter((rx) => `${rx.patientName} ${rx.medicine}`.toLowerCase().includes(q.toLowerCase()));

  const dispense = (rx) => run(async () => {
    await (await writeContract(session.signer).dispense(rx.id)).wait();
    state.reload();
  }, "Marked dispensed on-chain. It can't be used again.");

  return (
    <Shell session={session} subtitle="Pharmacy" tabs={[{ key: "rx", label: "Prescriptions", icon: <Pill size={17} /> }]} tab="rx" setTab={() => {}} onLogout={onLogout} toast={toast}>
      <PageHeader title="Verify & dispense" subtitle="Each prescription is checked against the hash its doctor signed on-chain. Once dispensed, it is closed for good." />
      <div className="vl-search-bar"><Search size={16} /><input placeholder="Search by patient or medicine…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <Loading state={state}>
        {state.data && (rows.length === 0 ? <EmptyState icon={<Pill size={28} />} title="No prescriptions found" body="Prescriptions issued by verified doctors appear here." />
          : <div className="vl-list">{rows.map((rx) => (
            <div className="vl-card vl-doctor-row" key={rx.id}>
              <div className="vl-doctor-row__info"><div className="vl-avatar vl-avatar--sm"><Pill size={15} /></div>
                <div><h4>{rx.medicine}</h4><div className="vl-muted">{rx.dosage}</div>
                  <div className="vl-muted">For {rx.patientName || short(rx.patient)} · by {rx.doctorName || short(rx.doctor)} · {new Date(rx.issuedAt * 1000).toLocaleDateString()}</div>
                  {rx.verified ? <CABadge /> : <StatusPill tone="red"><AlertTriangle size={12} /> Hash mismatch. Do not dispense</StatusPill>}</div></div>
              {rx.status === "dispensed" ? <StatusPill tone="green"><Check size={12} /> Already dispensed</StatusPill>
                : <button className="vl-btn vl-btn--primary" disabled={busy || !rx.verified} onClick={() => dispense(rx)}><Check size={15} /> Mark dispensed</button>}
            </div>))}</div>)}
      </Loading>
    </Shell>
  );
}
