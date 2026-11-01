import nacl from "tweetnacl";
import { ethers } from "ethers";

const KEY_MSG = "VitaLedger encryption key v1\nSigning is free and sends no transaction. Only sign this on VitaLedger.";

/** Keys come from the wallet signature, so the same wallet always gets the same keys. */
export async function deriveKeys(signer) {
  const sig = await signer.signMessage(KEY_MSG);
  const boxSeed = ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes(sig + ":box")));
  const dataKey = ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes(sig + ":data")));
  return { box: nacl.box.keyPair.fromSecretKey(boxSeed), dataKey };
}

export const pubKeyHex = (box) => ethers.hexlify(box.publicKey);

export function encryptBytes(bytes, key) {
  const nonce = nacl.randomBytes(24);
  const ct = nacl.secretbox(bytes, nonce, key);
  const out = new Uint8Array(24 + ct.length);
  out.set(nonce); out.set(ct, 24);
  return out;
}

export function decryptBytes(blob, key) {
  const pt = nacl.secretbox.open(blob.slice(24), blob.slice(0, 24), key);
  if (!pt) throw new Error("Could not decrypt. Wrong wallet or corrupted file.");
  return pt;
}

export const encryptJSON = (obj, key) => ethers.encodeBase64(encryptBytes(ethers.toUtf8Bytes(JSON.stringify(obj)), key));
export const decryptJSON = (b64, key) => JSON.parse(ethers.toUtf8String(decryptBytes(ethers.decodeBase64(b64), key)));

/** Patient -> doctor: encrypt the patient's data key to the doctor's public key. */
export function wrapKey(dataKey, recipientPubHex) {
  const eph = nacl.box.keyPair();
  const nonce = nacl.randomBytes(24);
  const ct = nacl.box(dataKey, nonce, ethers.getBytes(recipientPubHex), eph.secretKey);
  const out = new Uint8Array(32 + 24 + ct.length);
  out.set(eph.publicKey, 0); out.set(nonce, 32); out.set(ct, 56);
  return ethers.hexlify(out);
}

export function unwrapKey(hex, box) {
  const b = ethers.getBytes(hex);
  const key = nacl.box.open(b.slice(56), b.slice(32, 56), b.slice(0, 32), box.secretKey);
  if (!key) throw new Error("Could not unlock the patient's key.");
  return key;
}
