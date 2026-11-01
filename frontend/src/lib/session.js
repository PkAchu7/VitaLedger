import { deriveKeys } from "./crypto";

export async function buildSession(res, signer) {
  const needsKeys = ["patient", "doctor"].includes(res.role) && res.status === "approved";
  return { ...res, signer, keys: needsKeys ? await deriveKeys(signer) : null };
}
