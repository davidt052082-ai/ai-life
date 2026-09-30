import test from "node:test";
import assert from "node:assert/strict";
import { readHuaweiConfig } from "../src/integrations/huawei-health/config.js";
import { decryptSecret, encryptSecret } from "../src/integrations/huawei-health/crypto.js";
import { classifyHuaweiError } from "../src/integrations/huawei-health/errors.js";

test("disabled Huawei configuration needs no credentials", () => {
  assert.deepEqual(readHuaweiConfig({ HUAWEI_HEALTH_ENABLED: "false" }), { enabled: false });
});

test("enabled Huawei configuration validates its encryption key", () => {
  const env = {
    HUAWEI_HEALTH_ENABLED: "true",
    HUAWEI_CLIENT_ID: "client",
    HUAWEI_CLIENT_SECRET: "secret",
    HUAWEI_REDIRECT_URI: "https://ai-life.top/api/integrations/huawei/callback",
    HUAWEI_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64")
  };
  assert.equal(readHuaweiConfig(env).initialDays, 30);
  assert.throws(() => readHuaweiConfig({ ...env, HUAWEI_TOKEN_ENCRYPTION_KEY: "short" }), /32 bytes/);
});

test("token cipher authenticates the ciphertext", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  const encrypted = encryptSecret("refresh-token", key);
  assert.equal(decryptSecret(encrypted, key), "refresh-token");
  assert.throws(() => decryptSecret(encrypted, Buffer.alloc(32, 8).toString("base64")), (error) => error.code === "TOKEN_DECRYPT_FAILED");
});

test("provider errors are stable and safe", () => {
  assert.deepEqual(classifyHuaweiError({ status: 401 }), { code: "HUAWEI_REAUTH_REQUIRED", retryable: false });
  assert.deepEqual(classifyHuaweiError({ status: 429 }), { code: "HUAWEI_RATE_LIMITED", retryable: true });
  assert.deepEqual(classifyHuaweiError({ status: 502 }), { code: "HUAWEI_UPSTREAM_UNAVAILABLE", retryable: true });
});
