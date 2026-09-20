import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { createHealthOfflineQueue, isNetworkFailure } from "../health-offline.js";

test("offline queue preserves order, idempotency keys, JSON and meal blobs", async () => {
  const sent = [];
  const queue = createHealthOfflineQueue({ indexedDB: new IDBFactory(), fetchImpl: async (_url, init) => { sent.push(init); return new Response("{}", { status: 201 }); } });
  await queue.enqueue({ path: "/hydration", method: "POST", headers: { "Idempotency-Key": "water-1", "Content-Type": "application/json" }, body: JSON.stringify({ type: "water", volumeMl: 200 }) });
  const form = new FormData(); form.append("mealType", "lunch"); form.append("image", new Blob(["photo"], { type: "image/webp" }), "meal.webp");
  await queue.enqueue({ path: "/meals", method: "POST", headers: { "Idempotency-Key": "meal-1" }, body: form });
  assert.equal(await queue.count(), 2);
  assert.equal(await queue.replay("/api/projects/health/health"), 2);
  assert.deepEqual(sent.map((item) => item.headers.get("Idempotency-Key")), ["water-1", "meal-1"]);
  assert.equal(await queue.count(), 0);
  assert.equal(isNetworkFailure(new TypeError("Failed to fetch")), true);
  assert.equal(isNetworkFailure(new Error("validation failed")), false);
});

test("replay keeps the first failed record and stops before later records", async () => {
  const queue = createHealthOfflineQueue({ indexedDB: new IDBFactory(), fetchImpl: async () => { throw new TypeError("offline"); } });
  await queue.enqueue({ path: "/hydration", method: "POST", headers: { "Idempotency-Key": "first" }, body: "{}" });
  await queue.enqueue({ path: "/checkins", method: "POST", headers: { "Idempotency-Key": "second" }, body: "{}" });
  assert.equal(await queue.replay("/api/projects/health/health"), 0);
  assert.equal(await queue.count(), 2);
});

test("offline queue preserves a negative hydration adjustment", async () => {
  const sent = [];
  const queue = createHealthOfflineQueue({ indexedDB: new IDBFactory(), fetchImpl: async (_url, init) => { sent.push(init); return new Response("{}", { status: 201 }); } });
  await queue.enqueue({ path: "/hydration", method: "POST", headers: { "Idempotency-Key": "water-adjust", "Content-Type": "application/json" }, body: JSON.stringify({ type: "water", volumeMl: -100 }) });
  assert.equal(await queue.replay("/api/projects/health/health"), 1);
  assert.equal(await queue.count(), 0);
  assert.equal(JSON.parse(sent[0].body).volumeMl, -100);
});
