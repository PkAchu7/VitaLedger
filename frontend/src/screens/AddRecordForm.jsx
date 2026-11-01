import React, { useState } from "react";
import { Upload } from "lucide-react";
import { errMsg } from "../lib/api";
import { addEncryptedRecord } from "../lib/files";

export default function AddRecordForm({ session, patient, dataKey, onDone, notify }) {
  const [title, setTitle] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!title.trim() || !file) return notify("Add a title and choose a file.", "err");
    if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type)) return notify("Only PDF, JPG or PNG files are supported.", "err");
    if (file.size > 20 * 1024 * 1024) return notify("File must be under 20 MB.", "err");
    setBusy(true);
    try {
      await addEncryptedRecord({ session, patient, file, title: title.trim(), dataKey });
      notify("Encrypted, pinned to IPFS and anchored on-chain ✓");
      setTitle(""); setFile(null); e.target.reset();
      onDone?.();
    } catch (er) { notify(errMsg(er), "err"); } finally { setBusy(false); }
  }

  return (
    <form className="vl-card vl-form vl-form--wide" onSubmit={submit}>
      <label>Record title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. MRI — left knee" /></label>
      <label>File (PDF, JPG or PNG, up to 20 MB)<input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files[0] || null)} /></label>
      <button className="vl-btn vl-btn--primary vl-btn--block" disabled={busy}>
        <Upload size={15} /> {busy ? "Encrypting, uploading & anchoring…" : "Encrypt & upload"}
      </button>
    </form>
  );
}
