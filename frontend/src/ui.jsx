import React, { useState, useCallback, useEffect, useRef } from "react";
import { ShieldCheck, LogOut } from "lucide-react";
import { errMsg } from "./lib/api";

export function BrandMark() {
  // The one deliberate use of red: a small medical cross. Everything else is teal.
  return (
    <svg width="30" height="30" viewBox="0 0 40 40" fill="none">
      <rect x="1" y="1" width="38" height="38" rx="11" fill="#ffffff" stroke="#e4e1df" />
      <path d="M20 11v18M11 20h18" stroke="#B7362E" strokeWidth="4.5" strokeLinecap="round" />
      <circle cx="20" cy="20" r="15.5" stroke="#CFE7E6" strokeWidth="1.4" />
    </svg>
  );
}

export function Shell({ session, subtitle, tabs, tab, setTab, onLogout, footer, toast, children }) {
  return (
    <div className="vl-shell">
      <aside className="vl-sidebar">
        <div className="vl-sidebar__brand"><BrandMark /><span>VITalLedger</span></div>
        <div className="vl-sidebar__who">
          <div className="vl-avatar">{session.name.charAt(0).toUpperCase()}</div>
          <div><div className="vl-sidebar__name">{session.name}</div><div className="vl-sidebar__sub">{subtitle}</div></div>
        </div>
        <nav className="vl-nav">
          {tabs.map((t) => (
            <button key={t.key} className={tab === t.key ? "is-active" : ""} onClick={() => setTab(t.key)}>
              {t.icon}{t.label}
            </button>
          ))}
        </nav>
        <div className="vl-sidebar__footer">
          {footer}
          <button className="vl-logout" onClick={onLogout}><LogOut size={16} /> Sign out</button>
        </div>
      </aside>
      <main className="vl-main">{toast}{children}</main>
    </div>
  );
}

export const PageHeader = ({ title, subtitle }) => (
  <div className="vl-page-header"><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
);

export const EmptyState = ({ icon, title, body }) => (
  <div className="vl-empty">{icon}<h3>{title}</h3><p>{body}</p></div>
);

export const StatusPill = ({ tone, children }) => <span className={`vl-pill vl-pill--${tone}`}>{children}</span>;

export const CABadge = () => (
  <span className="vl-ca-badge"><ShieldCheck size={13} /> Verified on-chain</span>
);

export function Modal({ onClose, tone = "default", children }) {
  return (
    <div className="vl-modal-overlay" onClick={onClose}>
      <div className={`vl-modal vl-modal--${tone}`} style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function useToast() {
  const [msg, setMsg] = useState(null);
  const timer = useRef();
  const show = useCallback((text, tone = "ok") => {
    setMsg({ text, tone });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 5000);
  }, []);
  const node = msg ? <div className={`vl-toast${msg.tone === "err" ? " vl-toast--err" : ""}`}>{msg.text}</div> : null;
  return [node, show];
}

export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fn().then((data) => alive && setState({ data, loading: false, error: null }))
      .catch((error) => alive && setState({ data: null, loading: false, error }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

export function useBusy(notify) {
  const [busy, setBusy] = useState(false);
  const run = async (fn, okMsg) => {
    setBusy(true);
    try { const r = await fn(); if (okMsg) notify(okMsg); return r; }
    catch (e) { notify(errMsg(e), "err"); }
    finally { setBusy(false); }
  };
  return [busy, run];
}

export const Loading = ({ state, children }) =>
  state.loading && !state.data ? <p className="vl-muted">Loading from Sepolia…</p>
    : state.error ? <div className="vl-error">{errMsg(state.error)}</div> : children;
