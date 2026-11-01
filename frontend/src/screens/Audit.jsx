import React from "react";
import { Activity } from "lucide-react";
import { CONTRACT, readContract, readProvider, short } from "../lib/chain";
import { namesFor } from "../lib/api";
import { useLoad, Loading, EmptyState } from "../ui";

const lc = (a) => a.toLowerCase();

function describe(p) {
  const a = p.args;
  const roles = ["", "patient", "doctor", "pharmacy", "hospital"];
  const statuses = ["", "pending", "approved", "suspended"];
  switch (p.name) {
    case "UserRegistered": return { addrs: [lc(a.user)], text: (n) => `${n(a.user)} registered as ${roles[Number(a.role)]} (${statuses[Number(a.status)]})` };
    case "UserStatusChanged": return { addrs: [lc(a.user), lc(a.by)], text: (n) => `${n(a.by)} set ${n(a.user)} to ${statuses[Number(a.status)]}` };
    case "AccessRequested": return { addrs: [lc(a.patient), lc(a.doctor)], text: (n) => `${n(a.doctor)} requested access to ${n(a.patient)}'s records` };
    case "AccessGranted": return { addrs: [lc(a.patient), lc(a.doctor)], text: (n) => `${n(a.patient)} granted access to ${n(a.doctor)}` };
    case "AccessDenied": return { addrs: [lc(a.patient), lc(a.doctor)], text: (n) => `${n(a.patient)} denied ${n(a.doctor)}` };
    case "AccessRevoked": return { addrs: [lc(a.patient), lc(a.doctor)], text: (n) => `${n(a.patient)} revoked ${n(a.doctor)}'s access` };
    case "AccessWithdrawn": return { addrs: [lc(a.patient), lc(a.doctor)], text: (n) => `${n(a.doctor)} withdrew a request to ${n(a.patient)}` };
    case "RecordAdded": return { addrs: [lc(a.patient), lc(a.author)], text: (n) => `${n(a.author)} added a record to ${n(a.patient)}'s history` };
    case "RecordsViewed": return { addrs: [lc(a.patient), lc(a.doctor)], text: (n) => `${n(a.doctor)} viewed ${n(a.patient)}'s records` };
    case "BreakGlassUsed": return { addrs: [lc(a.patient), lc(a.doctor)], text: (n) => `BREAK-GLASS: ${n(a.doctor)} opened ${n(a.patient)}'s emergency info` };
    case "PrescriptionIssued": return { addrs: [lc(a.patient), lc(a.doctor)], text: (n) => `${n(a.doctor)} issued prescription #${a.id} for ${n(a.patient)}` };
    case "PrescriptionDispensed": return { addrs: [lc(a.pharmacy)], text: (n) => `${n(a.pharmacy)} dispensed prescription #${a.id}` };
    default: return null;
  }
}

/** Reads the permanent on-chain event history. `filter(row)` receives { addrs }. */
export default function Audit({ session, filter = () => true }) {
  const state = useLoad(async () => {
    const logs = await readProvider.getLogs({ address: CONTRACT.address, fromBlock: CONTRACT.deployBlock, toBlock: "latest" });
    const rows = [];
    for (const l of logs) {
      let p; try { p = readContract.interface.parseLog(l); } catch { continue; }
      const d = p && describe(p);
      if (d) rows.push({ ...d, name: p.name, block: l.blockNumber, idx: l.index, tx: l.transactionHash });
    }
    const shown = rows.filter(filter).sort((x, y) => y.block - x.block || y.idx - x.idx).slice(0, 80);
    const names = await namesFor(session, shown.flatMap((r) => r.addrs));
    const times = {};
    await Promise.all([...new Set(shown.map((r) => r.block))].map(async (b) => { times[b] = (await readProvider.getBlock(b))?.timestamp; }));
    return { shown, names, times };
  }, []);

  return (
    <Loading state={state}>
      {state.data && (state.data.shown.length === 0
        ? <EmptyState icon={<Activity size={28} />} title="Nothing logged yet" body="Activity will appear here as it happens on-chain." />
        : <div className="vl-audit-list">
            {state.data.shown.map((r) => {
              const nm = (addr) => state.data.names[lc(addr)] || short(addr);
              const t = state.data.times[r.block];
              return (
                <div className="vl-audit-row" key={r.tx + r.idx}>
                  <div className="vl-audit-row__icon"><Activity size={14} /></div>
                  <div className="vl-audit-row__body">
                    <div className="vl-audit-row__line" style={r.name === "BreakGlassUsed" ? { color: "var(--danger)", fontWeight: 600 } : null}>{r.text(nm)}</div>
                    <div className="vl-muted">{t ? new Date(t * 1000).toLocaleString() : `block ${r.block}`} · tx {short(r.tx)}</div>
                  </div>
                </div>
              );
            })}
          </div>)}
    </Loading>
  );
}
