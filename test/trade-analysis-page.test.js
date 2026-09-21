import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createApp } from "../server.js";
import { normalizeTradeAnalysisUrl } from "../src/trade-analysis/targetUrl.js";

const tradeAnalysisFilePath = fileURLToPath(new URL("../trade_analysis.html", import.meta.url));

async function request(app, path, options = {}) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const { port } = server.address();
    return await fetch(`http://127.0.0.1:${port}${path}`, { redirect: "manual", ...options });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function createTradeApp({ user = { id: "user-1" }, project = { code: "trade-analysis" }, tradeAnalysisUrl } = {}) {
  return createApp({
    userRepository: { findProjectAccess: async () => project },
    sessionService: { getCurrentUser: async () => user },
    tradeAnalysisUrl,
    tradeAnalysisFilePath
  });
}

test("normalizeTradeAnalysisUrl accepts only absolute HTTP(S) URLs", () => {
  assert.equal(normalizeTradeAnalysisUrl("https://trade.example.com/dashboard"), "https://trade.example.com/dashboard");
  assert.equal(normalizeTradeAnalysisUrl("http://localhost:8080/"), "http://localhost:8080/");
  assert.equal(normalizeTradeAnalysisUrl("file:///tmp/trade_analysis.html"), null);
  assert.equal(normalizeTradeAnalysisUrl("/dashboard"), null);
  assert.equal(normalizeTradeAnalysisUrl("javascript:alert(1)"), null);
  assert.equal(normalizeTradeAnalysisUrl(""), null);
});

test("GET /projects/trade-analysis redirects an authorized user to the configured dashboard", async () => {
  const response = await request(createTradeApp({ tradeAnalysisUrl: "https://trade.example.com/dashboard" }), "/projects/trade-analysis");

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://trade.example.com/dashboard");
});

test("GET /projects/trade-analysis sends unauthenticated users to login", async () => {
  const response = await request(createTradeApp({ user: null, tradeAnalysisUrl: "https://trade.example.com/" }), "/projects/trade-analysis");

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/login?next=/projects/trade-analysis");
});

test("GET /projects/trade-analysis returns unauthorized users to the project directory", async () => {
  const response = await request(createTradeApp({ project: null, tradeAnalysisUrl: "https://trade.example.com/" }), "/projects/trade-analysis");

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/");
});

test("GET /projects/trade-analysis returns 503 when the dashboard URL is unavailable", async () => {
  const response = await request(createTradeApp({ tradeAnalysisUrl: "file:///tmp/dashboard.html" }), "/projects/trade-analysis");

  assert.equal(response.status, 503);
  assert.match(await response.text(), /交易分析服务尚未配置/);
});

test("GET /trade-analysis.html sends unauthenticated users to login", async () => {
  const response = await request(createTradeApp({ user: null }), "/trade-analysis.html");

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/login?next=/projects/trade-analysis");
});

test("GET /trade-analysis.html returns unauthorized users to the project directory", async () => {
  const response = await request(createTradeApp({ project: null }), "/trade-analysis.html");

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/");
});

test("HEAD /trade-analysis.html serves the dashboard metadata to an authorized user", async () => {
  const response = await request(createTradeApp(), "/trade-analysis.html", { method: "HEAD" });

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/html/);
  assert.equal(Number(response.headers.get("content-length")), 14_103_303);
});
