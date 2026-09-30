import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function tokenKey(value) {
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("HUAWEI_TOKEN_ENCRYPTION_KEY must decode to 32 bytes.");
  return key;
}

function decryptError() {
  const error = new Error("Unable to decrypt Huawei credentials.");
  error.code = "TOKEN_DECRYPT_FAILED";
  return error;
}

export function encryptSecret(value, keyValue) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(keyValue), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(value, keyValue) {
  try {
    const [version, iv, tag, ciphertext] = String(value).split(".");
    if (version !== "v1" || !iv || !tag || !ciphertext) throw decryptError();
    const decipher = createDecipheriv("aes-256-gcm", tokenKey(keyValue), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch (error) {
    if (error?.code === "TOKEN_DECRYPT_FAILED") throw error;
    throw decryptError();
  }
}
