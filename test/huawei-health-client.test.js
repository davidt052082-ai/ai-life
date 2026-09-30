import test from "node:test";
import assert from "node:assert/strict";
import { createHuaweiHealthClient } from "../src/integrations/huawei-health/client.js";

test("client retries the official regional Health API location only once", async () => {
  const urls = [];
  const client = createHuaweiHealthClient({ config: { apiBase: "https://health-api.cloud.huawei.com/healthkit/v2", clientId: "client" }, fetchImpl: async (url) => {
    urls.push(url);
    if (urls.length === 1) return { ok: false, status: 403, headers: new Headers({ Location: "https://health-api.cloud.huawei.eu/healthkit/v2/sampleSet:polymerize" }), json: async () => ({ error: { code: 121001 } }) };
    return { ok: true, json: async () => ({ samplePoints: [] }) };
  } });
  await client.polymerizeDaily("token", { dataTypeName: "com.huawei.continuous.steps.delta", startTime: 0, endTime: 1, timezone: "Asia/Shanghai" });
  assert.equal(urls.length, 2);
  assert.match(urls[1], /^https:\/\/health-api\.cloud\.huawei\.eu\//);
});

test("client converts grouped daily points into only approved daily values", async () => {
  const client = createHuaweiHealthClient({ config: { apiBase: "https://health-api.cloud.huawei.com/healthkit/v2", clientId: "client" }, fetchImpl: async (_url, options) => {
    const type = JSON.parse(options.body).polymerizeWith[0].dataTypeName;
    const field = type.includes("steps") ? "steps" : type.includes("calories") ? "calories" : "intensity";
    return { ok: true, json: async () => ({ group: [{ sampleSet: [{ samplePoints: [{ startTime: Date.parse("2026-09-29T00:00:00Z"), value: [{ fieldName: field, integerValue: field === "steps" ? 8624 : 47 }] }] }] }] }) };
  } });
  const result = await client.collectDaily({ token: "token", timezone: "Asia/Shanghai", window: { start: new Date("2026-09-28T00:00:00Z"), end: new Date("2026-09-30T00:00:00Z") } });
  assert.equal(result.daily[0].steps, 8624);
  assert.equal(result.daily[0].exerciseMinutes, 47);
});
