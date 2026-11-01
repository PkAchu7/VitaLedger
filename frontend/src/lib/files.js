import { ethers } from "ethers";
import { api } from "./api";
import { writeContract } from "./chain";
import { encryptBytes, encryptJSON, decryptJSON } from "./crypto";

export function saveBlob(bytes, name, mime = "application/octet-stream") {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** encrypt in the browser -> pin ciphertext to IPFS via backend -> anchor on-chain */
export async function addEncryptedRecord({ session, patient, file, title, dataKey }) {
  const enc = encryptBytes(new Uint8Array(await file.arrayBuffer()), dataKey);
  const fileHash = ethers.keccak256(enc);
  const form = new FormData();
  form.append("patient", patient);
  form.append("file", new Blob([enc]), "record.enc");
  const { cid } = await api("/files/upload", { method: "POST", token: session.token, form });
  const meta = encryptJSON({
    title, type: file.type === "application/pdf" ? "pdf" : "image", name: file.name, mime: file.type,
  }, dataKey);
  await (await writeContract(session.signer).addRecord(patient, cid, fileHash, meta)).wait();
}

export function readRecords(list, dataKey) {
  return list.map((r) => {
    let m = {};
    try { m = decryptJSON(r.meta, dataKey); } catch { m = { title: "(could not decrypt)" }; }
    return { id: Number(r.id), cid: r.cid, fileHash: r.fileHash, author: r.author, createdAt: Number(r.createdAt), ...m };
  }).reverse();
}
