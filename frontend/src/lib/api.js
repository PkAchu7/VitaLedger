import { ethers } from "ethers";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";

export async function api(path, { method = "GET", body, token, pinToken, form, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (pinToken) headers["x-pin-token"] = pinToken;
  let payload;
  if (form) payload = form;
  else if (body) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  if (!res.ok) {
    let msg = "Request failed.";
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return raw ? new Uint8Array(await res.arrayBuffer()) : res.json();
}

const REVERT_TRANSLATIONS = {
  "not active": "Your account is not approved or active yet. (Doctors require hospital approval; hospitals require admin approval.)",
  "already requested": "An access request for this patient is already pending.",
  "no access": "You do not have active access/consent for this patient's records.",
  "no request": "No pending access request was found.",
  "not a patient": "The specified address is not a registered patient.",
  "already registered": "This wallet address is already registered on-chain.",
  "already dispensed": "This prescription has already been dispensed.",
  "unknown hospital": "Selected hospital is not verified on-chain. Please choose a valid hospital.",
  "locked by admin": "This account was locked by the platform admin and cannot be approved by a hospital.",
  "not your doctor": "This doctor does not belong to your hospital.",
  "admin only": "This action requires platform administrator privileges.",
  "unknown prescription": "Prescription ID not found on-chain.",
  "admin wallet": "The admin wallet cannot be registered as a regular user role.",
  "key required": "Encryption key is missing or invalid.",
  "zero address": "Invalid wallet address.",
  "insufficient funds": "Insufficient Sepolia ETH in your wallet to cover network gas fees.",
};

function decodeHexRevert(hex) {
  if (!hex || typeof hex !== "string" || !hex.startsWith("0x")) return null;
  try {
    if (hex.startsWith("0x08c379a0") && hex.length >= 138) {
      return ethers.AbiCoder.defaultAbiCoder().decode(["string"], ethers.dataSlice(hex, 4))[0];
    }
    if (hex.startsWith("0x4e487b71") && hex.length >= 74) {
      const code = ethers.AbiCoder.defaultAbiCoder().decode(["uint256"], ethers.dataSlice(hex, 4))[0];
      return `Contract execution failed (Panic code 0x${code.toString(16)})`;
    }
  } catch {
    /* ignore decoding errors */
  }
  return null;
}

function cleanMsg(str) {
  if (!str || typeof str !== "string") return "";
  let s = str.trim();
  s = s.replace(/^execution reverted:?/i, "");
  s = s.replace(/^reverted with reason string:?/i, "");
  s = s.replace(/^VM Exception while processing transaction: reverted with reason string/i, "");
  s = s.replace(/^VM Exception while processing transaction: revert/i, "");
  s = s.replace(/^VM Exception while processing transaction:/i, "");
  s = s.replace(/^[’'"\s]+|[’'"\s]+$/g, "").trim();
  return s;
}

function translateReason(raw) {
  if (!raw) return "";
  const cleaned = cleanMsg(raw);
  const lower = cleaned.toLowerCase();
  for (const [key, val] of Object.entries(REVERT_TRANSLATIONS)) {
    if (lower === key || lower.includes(key)) return val;
  }
  return cleaned;
}

/**
 * Robustly parses and translates any error from Ethers, MetaMask, JSON-RPC, or API.
 * Prevents useless "could not coalesce error" messages from ever surfacing to users.
 */
export function errMsg(e) {
  if (!e) return "Something went wrong.";
  if (typeof e === "string") {
    if (!e.includes("could not coalesce error")) return translateReason(e) || e;
  }

  // 1. User rejection / cancellation in wallet
  if (
    e?.code === 4001 ||
    e?.code === "ACTION_REJECTED" ||
    e?.info?.error?.code === 4001 ||
    e?.error?.code === 4001 ||
    /user rejected|user denied/i.test(String(e?.message || "")) ||
    /user rejected|user denied/i.test(String(e?.error?.message || ""))
  ) {
    return "Transaction was cancelled in your wallet.";
  }

  // 2. Insufficient gas / ETH funds
  if (
    e?.code === "INSUFFICIENT_FUNDS" ||
    /insufficient funds/i.test(String(e?.message || "")) ||
    /insufficient funds/i.test(String(e?.error?.message || ""))
  ) {
    return "Insufficient Sepolia ETH in your wallet to cover network gas fees.";
  }

  // 3. Nonce out of sync
  if (e?.code === "NONCE_EXPIRED" || /nonce (has already been used|too low)/i.test(String(e?.message || ""))) {
    return "Transaction nonce out of sync. Please reset your MetaMask activity cache (Settings > Advanced > Clear activity tab data).";
  }

  // 4. Decoded reason directly from ethers
  if (e?.reason && typeof e.reason === "string" && !e.reason.includes("could not coalesce error")) {
    const t = translateReason(e.reason);
    if (t) return t;
  }

  // 5. Hex revert data in various error fields
  const hexCandidates = [
    e?.data,
    e?.error?.data?.data,
    e?.error?.data,
    e?.info?.error?.data?.data,
    e?.info?.error?.data,
  ];
  for (const hex of hexCandidates) {
    if (typeof hex === "string" && hex.startsWith("0x")) {
      const decoded = decodeHexRevert(hex);
      if (decoded) return translateReason(decoded);
    }
  }

  // 6. Nested error messages from MetaMask / RPC
  const msgCandidates = [
    e?.error?.data?.message,
    e?.info?.error?.data?.message,
    e?.error?.message,
    e?.info?.error?.message,
    e?.data?.message,
  ];
  for (const m of msgCandidates) {
    if (typeof m === "string" && m && !m.includes("Internal JSON-RPC error") && !m.includes("could not coalesce error")) {
      const t = translateReason(m);
      if (t) return t;
    }
  }

  // 7. Ethers shortMessage if meaningful and not coalesce error
  if (e?.shortMessage && typeof e.shortMessage === "string" && !e.shortMessage.includes("could not coalesce error")) {
    const t = translateReason(e.shortMessage);
    if (t) return t;
  }

  // 8. Extraction from error.message string
  if (e?.message && typeof e.message === "string") {
    // Look for embedded revert hex string
    const hexMatch = e.message.match(/0x08c379a0[0-9a-fA-F]+/);
    if (hexMatch) {
      const decoded = decodeHexRevert(hexMatch[0]);
      if (decoded) return translateReason(decoded);
    }

    // Look for embedded execution revert string
    const revertMatch =
      e.message.match(/execution reverted:?\s*([^\",\\\}]+)/i) ||
      e.message.match(/reverted with reason string [\'\"]([^\'\"]+)[\'\"]/i);
    if (revertMatch && revertMatch[1]) {
      const t = translateReason(revertMatch[1]);
      if (t) return t;
    }

    // Look for embedded JSON message
    const jsonMsgMatch = e.message.match(/"message":\s*"([^"]+)"/);
    if (
      jsonMsgMatch &&
      jsonMsgMatch[1] &&
      !jsonMsgMatch[1].includes("Internal JSON-RPC error") &&
      !jsonMsgMatch[1].includes("could not coalesce error")
    ) {
      const t = translateReason(jsonMsgMatch[1]);
      if (t) return t;
    }

    if (!e.message.includes("could not coalesce error")) {
      const cleaned = cleanMsg(e.message);
      if (cleaned) return cleaned;
    }
  }

  return "Contract transaction failed. Please check your inputs, account approval, and gas balance.";
}

/** address(lowercase) -> display name, for any list of addresses. */
export async function namesFor(session, addrs) {
  const list = [...new Set(addrs.map((a) => a.toLowerCase()))];
  const out = {};
  for (let i = 0; i < list.length; i += 100) {
    const part = list.slice(i, i + 100);
    Object.assign(out, await api(`/names?addresses=${part.join(",")}`, { token: session.token }));
  }
  return out;
}
