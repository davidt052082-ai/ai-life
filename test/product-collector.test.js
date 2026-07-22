import test from "node:test";
import assert from "node:assert/strict";

test("collector extracts Xiaomi Mi Band wearable fields from official page HTML", async () => {
  const { collectProductFromHtml } = await import("../src/product-collector/index.js");

  const html = `
    <!doctype html>
    <html lang="zh-TW">
      <head>
        <title>小米手環 - 小米官網</title>
        <meta property="og:title" content="小米手環" />
        <meta property="og:description" content="美國 ADI 傳感器，偵測運動及睡眠品質。光感版支援即時心率偵測。" />
      </head>
      <body>
        <h1>小米手環 全新推出光感版</h1>
        <p>小米手環幫你記錄全天活動，計算行走距離及熱量消耗。</p>
        <p>光感版支援即時心率偵測，採用光電式心率傳感器。</p>
        <p>手環可以與手機通過低功耗藍牙（BLE）即時連接。</p>
        <section>
          <h2>規格</h2>
          <p>待機時長：30 天</p>
          <p>防水等級 IP67</p>
          <p>藍牙晶片：Dialog 頂級藍牙晶片（藍牙 4.0）</p>
          <p>感應器：ADI 軍規重力感應器</p>
          <p>心率傳感器：光電式心率感應器</p>
          <p>測量方法：光電容積脈搏波描記法（PPG）</p>
        </section>
      </body>
    </html>
  `;

  const result = await collectProductFromHtml({
    url: "https://www.mi.com/tw/miband/",
    html
  });

  assert.equal(result.sourceUrl, "https://www.mi.com/tw/miband/");
  assert.equal(result.sourceType, "official");
  assert.equal(result.deviceType, "wristband");
  assert.equal(result.bodyPart, "wrist");
  assert.equal(result.usagePositionLabel, "手腕");
  assert.match(result.nameZh, /小米手[环環]/);
  assert.ok(result.metrics.includes("activity"));
  assert.ok(result.metrics.includes("sleep"));
  assert.ok(result.metrics.includes("heart_rate"));
  assert.ok(result.functionPoints.includes("运动"));
  assert.ok(result.functionPoints.includes("睡眠"));
  assert.ok(result.functionPoints.includes("心率"));
  assert.ok(result.functionPoints.includes("PPG"));
  assert.equal(result.specs.waterResistance, "IP67");
  assert.match(result.specs.connectivity, /Bluetooth 4\.0|BLE/);
  assert.ok(result.warnings.length >= 1);
});

test("collector extracts JD wearable product fields from accessible item HTML", async () => {
  const { collectProductFromHtml } = await import("../src/product-collector/index.js");
  const html = `
    <!doctype html>
    <html>
      <head>
        <title>华为手环 9 智能运动手环 - 京东</title>
        <meta name="description" content="华为手环 9，支持心率、血氧、睡眠、运动监测，蓝牙连接。" />
        <meta property="og:image" content="//img10.360buyimg.com/n1/jfs/jd-watch.jpg" />
      </head>
      <body>
        <div class="sku-name">华为手环 9 智能运动手环</div>
        <img id="spec-img" data-origin="//img10.360buyimg.com/n1/jfs/jd-watch.jpg" />
        <ul class="parameter2">
          <li title="品牌：华为">品牌：华为</li>
          <li title="型号：Band 9">型号：Band 9</li>
          <li title="续航时间：约14天">续航时间：约14天</li>
          <li title="防水等级：5ATM">防水等级：5ATM</li>
          <li title="连接方式：蓝牙">连接方式：蓝牙</li>
        </ul>
        <div class="detail">
          支持心率监测、血氧检测、睡眠分析、运动记录，佩戴在手腕。
        </div>
      </body>
    </html>
  `;

  const result = await collectProductFromHtml({
    url: "https://item.jd.com/100304416498.html",
    html
  });

  assert.equal(result.sourceType, "commerce");
  assert.equal(result.skuId, "100304416498");
  assert.equal(result.brand, "华为");
  assert.match(result.nameZh, /华为手环 9/);
  assert.equal(result.nameEn, "JD Product 100304416498");
  assert.equal(result.deviceType, "wristband");
  assert.equal(result.bodyPart, "wrist");
  assert.equal(result.usagePositionLabel, "手腕");
  assert.ok(result.functionPoints.includes("心率"));
  assert.ok(result.functionPoints.includes("血氧"));
  assert.ok(result.functionPoints.includes("睡眠"));
  assert.equal(result.specs.skuId, "100304416498");
  assert.equal(result.specs.batteryLife, "约14天");
  assert.equal(result.specs.waterResistance, "5ATM");
  assert.equal(result.imageUrl, "https://img10.360buyimg.com/n1/jfs/jd-watch.jpg");
  assert.equal(result.purchaseUrl, "https://item.jd.com/100304416498.html");
});

test("collector returns JD SKU and warning when item page is verification wall", async () => {
  const { collectProductFromHtml } = await import("../src/product-collector/index.js");
  const result = await collectProductFromHtml({
    url: "https://item.jd.com/100304416498.html?pcdk=sample",
    html: '<!doctype html><html><head><title>京东验证</title></head><body><script>window.bp_bizid="JDR_shields"</script>京东验证</body></html>'
  });

  assert.equal(result.sourceType, "commerce");
  assert.equal(result.skuId, "100304416498");
  assert.equal(result.nameZh, "京东商品 100304416498");
  assert.equal(result.nameEn, "JD Product 100304416498");
  assert.equal(result.purchaseUrl, "https://item.jd.com/100304416498.html");
  assert.ok(result.warnings.some((warning) => warning.includes("京东页面触发验证")));
  assert.equal(result.specs.skuId, "100304416498");
});

test("collector recognizes JD SKU URL without html suffix", async () => {
  const { collectProductFromHtml } = await import("../src/product-collector/index.js");
  const result = await collectProductFromHtml({
    url: "https://item.jd.com/100304416498?pcdk=sample",
    html: '<!doctype html><html><head><title>京东验证</title></head><body><script>window.bp_bizid="JDR_shields"</script>京东验证</body></html>'
  });

  assert.equal(result.sourceType, "commerce");
  assert.equal(result.skuId, "100304416498");
  assert.equal(result.nameZh, "京东商品 100304416498");
  assert.equal(result.purchaseUrl, "https://item.jd.com/100304416498.html");
  assert.ok(result.warnings.some((warning) => warning.includes("京东页面触发验证")));
});

import { validatePublicProductUrl } from "../src/product-collector/urlSafety.js";

test("URL safety allows public http and https URLs", () => {
  assert.equal(validatePublicProductUrl("https://www.mi.com/tw/miband/").href, "https://www.mi.com/tw/miband/");
  assert.equal(validatePublicProductUrl("http://example.com/product").protocol, "http:");
});

test("URL safety rejects unsafe URLs", () => {
  const unsafeUrls = [
    "file:///etc/passwd",
    "data:text/plain,hello",
    "ftp://example.com/product",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://10.0.0.5/product",
    "http://172.16.0.1/product",
    "http://192.168.1.10/product"
  ];

  for (const url of unsafeUrls) {
    assert.throws(
      () => validatePublicProductUrl(url),
      { name: "CollectorError", code: "INVALID_URL" },
      url
    );
  }
});

import { extractPageData } from "../src/product-collector/extractPageData.js";

test("extractPageData reads title, meta, JSON-LD, visible text, links, and specs", () => {
  const html = `
    <html>
      <head>
        <title>Example Watch</title>
        <meta property="og:title" content="Example Smartwatch" />
        <meta property="og:description" content="Tracks heart rate and sleep." />
        <meta property="og:image" content="/watch.jpg" />
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": "Example Watch Pro",
            "brand": { "name": "Example" },
            "image": "https://example.com/image.jpg",
            "offers": { "price": "199", "priceCurrency": "USD", "url": "https://example.com/buy" }
          }
        </script>
      </head>
      <body>
        <h1>Example Watch Pro</h1>
        <a href="/buy">立即購買</a>
        <table>
          <tr><th>防水等級</th><td>IP68</td></tr>
          <tr><th>連接</th><td>Bluetooth 5.3</td></tr>
        </table>
      </body>
    </html>
  `;

  const data = extractPageData(html, "https://example.com/product");

  assert.equal(data.title, "Example Watch");
  assert.equal(data.meta.ogTitle, "Example Smartwatch");
  assert.equal(data.productJsonLd.name, "Example Watch Pro");
  assert.equal(data.productJsonLd.brand, "Example");
  assert.equal(data.productJsonLd.price, "199");
  assert.equal(data.productJsonLd.currency, "USD");
  assert.equal(data.imageUrl, "https://example.com/image.jpg");
  assert.equal(data.purchaseUrl, "https://example.com/buy");
  assert.match(data.visibleText, /Example Watch Pro/);
  assert.equal(data.specText, "防水等級 IP68\n連接 Bluetooth 5.3");
});

import { normalizeWearableProduct } from "../src/product-collector/normalizeWearable.js";

test("normalizeWearableProduct maps Xiaomi Mi Band text to equipment schema", () => {
  const result = normalizeWearableProduct({
    sourceUrl: "https://www.mi.com/tw/miband/",
    title: "小米手環 - 小米官網",
    headings: ["小米手環 全新推出光感版", "規格"],
    meta: {
      ogTitle: "小米手環",
      ogDescription: "偵測運動及睡眠品質，光感版支援即時心率偵測"
    },
    productJsonLd: {},
    visibleText: "小米手環 偵測運動及睡眠品質 即時心率偵測 低功耗藍牙 BLE IP67 30 天 光電容積脈搏波描記法 PPG",
    specText: "防水等級 IP67\n藍牙晶片 藍牙 4.0\n待機時長 30 天\n心率傳感器 光電式心率感應器\n感應器 ADI 軍規重力感應器",
    imageUrl: null,
    purchaseUrl: "https://www.mi.com/tw/miband/"
  });

  assert.equal(result.brand, "Xiaomi");
  assert.equal(result.sourceType, "official");
  assert.equal(result.deviceType, "wristband");
  assert.equal(result.bodyPart, "wrist");
  assert.equal(result.usagePositionLabel, "手腕");
  assert.ok(result.metrics.includes("activity"));
  assert.ok(result.metrics.includes("sleep"));
  assert.ok(result.metrics.includes("heart_rate"));
  assert.ok(result.functionPoints.includes("运动"));
  assert.ok(result.functionPoints.includes("睡眠"));
  assert.ok(result.functionPoints.includes("心率"));
  assert.ok(result.functionPoints.includes("PPG"));
  assert.equal(result.specs.waterResistance, "IP67");
  assert.match(result.specs.connectivity, /Bluetooth 4\.0|BLE/);
  assert.match(result.specs.batteryLife, /30/);
  assert.ok(result.confidence.overall > 0.7);
});

test("normalizeWearableProduct maps ESG waist sensor function points", () => {
  const result = normalizeWearableProduct({
    sourceUrl: "https://example.com/esg-waist-sensor",
    title: "腹部 ESG 能量腰带",
    headings: ["腹部 ESG 能量腰带"],
    meta: {
      ogTitle: "腹部 ESG 能量腰带",
      ogDescription: "监测胃电节律、核心体温和消化负荷"
    },
    productJsonLd: {},
    visibleText: "腹部 腰部 ESG 胃电节律 核心体温 消化负荷 posture 姿态",
    specText: "传感器 ESG 胃电传感器 体温传感器",
    imageUrl: null,
    purchaseUrl: "https://example.com/esg-waist-sensor"
  });

  assert.equal(result.deviceType, "waist_sensor");
  assert.equal(result.bodyPart, "waist");
  assert.equal(result.usagePositionLabel, "腹部/腰部");
  assert.ok(result.metrics.includes("esg"));
  assert.ok(result.metrics.includes("temperature"));
  assert.ok(result.functionPoints.includes("ESG"));
  assert.ok(result.functionPoints.includes("体温"));
  assert.ok(result.functionPoints.includes("姿态"));
});

import { fetchProductPage } from "../src/product-collector/fetchPage.js";

test("fetchProductPage converts non-ok responses into CollectorError", async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 403,
    text: async () => "Forbidden"
  });

  await assert.rejects(
    () => fetchProductPage("https://example.com/product", { fetchImpl: fakeFetch }),
    { name: "CollectorError", code: "BLOCKED_OR_LOGIN_REQUIRED" }
  );
});

test("fetchProductPage returns HTML for ok text responses", async () => {
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    headers: new Map([["content-type", "text/html; charset=utf-8"]]),
    text: async () => "<html><body><h1>Example Smartwatch Product</h1><p>This page has enough visible product content for collection.</p></body></html>"
  });

  const html = await fetchProductPage("https://example.com/product", { fetchImpl: fakeFetch });
  assert.match(html, /Product/);
});

import { createApp } from "../server.js";

async function postCollectProduct(app, body) {
  return postRoute(app, "/api/collect-product", body);
}

async function postRoute(app, routePath, body) {
  const route = app._router.stack.find((layer) => layer.route?.path === routePath);
  const handler = route?.route.stack.find((layer) => layer.method === "post")?.handle;
  assert.equal(typeof handler, "function");

  const req = { body };
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    set(headers) {
      this.headers = { ...this.headers, ...headers };
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    }
  };

  await handler(req, res);
  return { status: res.statusCode, body: res.body, headers: res.headers };
}

test("POST /api/collect-product validates missing URL", async () => {
  const app = createApp({
    collectProductFromUrl: async () => {
      throw new Error("should not be called");
    }
  });

  const response = await postCollectProduct(app, {});

  assert.equal(response.status, 400);
  assert.equal(response.body.error, "INVALID_URL");
});

test("POST /api/collect-product returns collected product JSON", async () => {
  const app = createApp({
    collectProductFromUrl: async (url) => ({
      sourceUrl: url,
      sourceType: "official",
      brand: "Xiaomi",
      nameZh: "小米手环",
      nameEn: "Mi Band",
      deviceType: "wristband",
      bodyPart: "wrist",
      usagePositionLabel: "手腕",
      metrics: ["activity", "sleep", "heart_rate"],
      functionPoints: ["运动", "睡眠", "心率"],
      coverage: "手腕运动、睡眠与心率监测",
      precision: "页面说明支持运动数据、睡眠质量和光感版实时心率；未提供医学级精度数值",
      price: null,
      currency: null,
      imageUrl: null,
      purchaseUrl: url,
      releasedAt: null,
      specs: { waterResistance: "IP67" },
      confidence: { overall: 0.8, fields: {} },
      warnings: [],
      rawEvidence: { title: "小米手環", matchedTerms: [] }
    })
  });

  const response = await postCollectProduct(app, { url: "https://www.mi.com/tw/miband/" });

  assert.equal(response.status, 200);
  assert.equal(response.body.nameZh, "小米手环");
  assert.equal(response.body.deviceType, "wristband");
});

test("POST /api/collect-product returns JD verification fallback JSON", async () => {
  const app = createApp({
    collectProductFromUrl: async (url) => ({
      sourceUrl: url,
      sourceType: "commerce",
      brand: "京东",
      model: "100304416498",
      skuId: "100304416498",
      nameZh: "京东商品 100304416498",
      nameEn: "JD Product 100304416498",
      deviceType: "other",
      bodyPart: "unknown",
      usagePositionLabel: "未知位置",
      metrics: [],
      functionPoints: [],
      coverage: "京东商品 SKU 100304416498",
      precision: "京东页面触发验证，已提取 SKU，商品详情需通过可访问页面或后续接口补全。",
      price: null,
      currency: null,
      imageUrl: null,
      purchaseUrl: "https://item.jd.com/100304416498.html",
      releasedAt: null,
      specs: { skuId: "100304416498" },
      confidence: { overall: 0.25, fields: {} },
      warnings: ["京东页面触发验证，无法直接读取商品详情。"],
      rawEvidence: { title: "京东验证", matchedTerms: ["sku:100304416498"] }
    })
  });

  const response = await postCollectProduct(app, {
    url: "https://item.jd.com/100304416498.html?pcdk=sample"
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.sourceType, "commerce");
  assert.equal(response.body.skuId, "100304416498");
  assert.equal(response.body.nameEn, "JD Product 100304416498");
  assert.ok(response.body.warnings[0].includes("京东页面触发验证"));
});

test("POST /api/browser/open-product opens product page through browser collector", async () => {
  const app = createApp({
    browserCollector: {
      openProductPage: async (url) => ({
        opened: true,
        url,
        currentUrl: url,
        title: "京东商品",
        message: "已打开浏览器。"
      }),
      collectCurrentProduct: async () => {
        throw new Error("should not be called");
      }
    }
  });

  const response = await postRoute(app, "/api/browser/open-product", {
    url: "https://item.jd.com/100304416498.html"
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.opened, true);
  assert.equal(response.body.currentUrl, "https://item.jd.com/100304416498.html");
});

test("POST /api/browser/collect-current returns browser page collection", async () => {
  const app = createApp({
    browserCollector: {
      openProductPage: async () => {
        throw new Error("should not be called");
      },
      collectCurrentProduct: async () => ({
        sourceType: "commerce",
        skuId: "100304416498",
        nameZh: "小米 Watch 5 eSIM",
        nameEn: "JD Product 100304416498",
        deviceType: "smartwatch",
        bodyPart: "wrist",
        usagePositionLabel: "手腕",
        functionPoints: ["心率", "睡眠"]
      })
    }
  });

  const response = await postRoute(app, "/api/browser/collect-current", {});

  assert.equal(response.status, 200);
  assert.equal(response.body.sourceType, "commerce");
  assert.equal(response.body.skuId, "100304416498");
  assert.equal(response.body.usagePositionLabel, "手腕");
});

test("POST /api/share-image returns generated PNG", async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const app = createApp({
    renderShareImagePng: async (html) => {
      assert.match(html, /share-section/);
      return png;
    }
  });

  const response = await postRoute(app, "/api/share-image", {
    html: '<main><section class="share-section">系统评测</section></main>'
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers["Content-Type"], "image/png");
  assert.equal(response.headers["Content-Disposition"], 'attachment; filename="system-monitor-evaluation.png"');
  assert.equal(response.body, png);
});

test("browser collector falls back from Chrome channel to bundled Chromium", async () => {
  const { createBrowserProductCollector } = await import("../src/product-collector/browserCollector.js");
  const launchOptions = [];
  const fakePage = {
    isClosed: () => false,
    goto: async () => {},
    title: async () => "京东商品",
    url: () => "https://item.jd.com/100304416498.html"
  };
  const fakeChromium = {
    launchPersistentContext: async (_profileDir, options) => {
      launchOptions.push(options);
      if (options.channel === "chrome") {
        throw new Error("Chrome is unavailable");
      }
      return {
        pages: () => [fakePage],
        newPage: async () => fakePage,
        close: async () => {}
      };
    }
  };
  const collector = createBrowserProductCollector({
    chromium: fakeChromium,
    profileDir: "/tmp/ai-life-test-browser-profile"
  });

  const result = await collector.openProductPage("https://item.jd.com/100304416498.html");

  assert.equal(result.opened, true);
  assert.equal(launchOptions[0].channel, "chrome");
  assert.equal(Object.hasOwn(launchOptions[1], "channel"), false);
});
