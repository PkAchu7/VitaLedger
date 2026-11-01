import React, { useState } from "react";
import { Clock, Ban } from "lucide-react";
import { readContract, STATUS } from "./lib/chain";
import { buildSession } from "./lib/session";
import { errMsg } from "./lib/api";
import { BrandMark } from "./ui";
import Auth from "./screens/Auth";
import Patient from "./screens/Patient";
import Doctor from "./screens/Doctor";
import Pharmacy from "./screens/Pharmacy";
import Org from "./screens/Org";

function Waiting({ session, onRefresh, onLogout }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const suspended = session.status === "suspended";
  const who = session.role === "doctor" ? "your hospital or the platform admin" : session.role === "pharmacy" ? "a hospital or the platform admin" : "the platform admin";
  return (
    <div className="vl-center">
      <div>
        <BrandMark />
        <h2 style={{ margin: "14px 0 8px" }}>{suspended ? "Account suspended" : "Waiting for approval"}</h2>
        <p className="vl-muted" style={{ lineHeight: 1.6 }}>
          {suspended ? "Your account has been suspended. Please contact " : `Your ${session.role} application is on-chain and waiting for `}{who}{suspended ? "." : " to verify it."}
        </p>
        {msg && <div className="vl-error" style={{ marginTop: 12 }}>{msg}</div>}
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 18 }}>
          <button className="vl-btn vl-btn--primary" disabled={busy} onClick={async () => { setBusy(true); setMsg(""); try { await onRefresh(); } catch (e) { setMsg(errMsg(e)); } finally { setBusy(false); } }}>
            {suspended ? <Ban size={15} /> : <Clock size={15} />} Check status
          </button>
          <button className="vl-btn vl-btn--ghost" onClick={onLogout}>Sign out</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const logout = () => setSession(null);

  async function refresh() {
    const u = await readContract.users(session.address);
    const status = STATUS[Number(u.status)];
    setSession(await buildSession({ ...session, status }, session.signer));
  }

  let view;
  if (!session) view = <Auth onSession={setSession} />;
  else if (session.status !== "approved") view = <Waiting session={session} onRefresh={refresh} onLogout={logout} />;
  else if (session.role === "patient") view = <Patient session={session} onLogout={logout} />;
  else if (session.role === "doctor") view = <Doctor session={session} onLogout={logout} />;
  else if (session.role === "pharmacy") view = <Pharmacy session={session} onLogout={logout} />;
  else view = <Org session={session} onLogout={logout} />; // hospital or admin

  return <div className="vl-root">{view}</div>;
}
