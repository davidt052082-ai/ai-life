import test from "node:test";
import assert from "node:assert/strict";
import { createHuaweiHealthService } from "../src/integrations/huawei-health/service.js";

test("connection service creates short-lived OAuth authorization without exposing credentials", async () => {
  let saved;
  const service = createHuaweiHealthService({
    config: { enabled: true, clientId: "client", redirectUri: "https://ai-life.top/api/integrations/huawei/callback", tokenKey: "key", scopes: ["health.read"] },
    repository: { createOAuthState: async (input) => { saved = input; } }, syncService: {}
  });
  const authorizationUrl = await service.beginConnection({ userId: "u", projectId: "p" });
  assert.equal(new URL(authorizationUrl).searchParams.get("access_type"), "offline");
  assert.equal(saved.userId, "u");
  assert.equal(saved.projectId, "p");
  assert.ok(saved.expiresAt > new Date());
});

test("disabled connection service reports safely without making outbound calls", async () => {
  const service = createHuaweiHealthService({ config: { enabled: false }, repository: {}, syncService: {} });
  assert.deepEqual(await service.status({ userId: "u" }), { enabled: false, status: "disabled" });
  await assert.rejects(() => service.beginConnection({ userId: "u", projectId: "p" }), { code: "HUAWEI_DISABLED" });
});
