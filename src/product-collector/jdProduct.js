import * as cheerio from "cheerio";
import { normalizeWearableProduct } from "./normalizeWearable.js";

function cleanText(value = "") {
  return value.replace(/\s+/g, " ").trim();
}

function absoluteUrl(value, baseUrl) {
  if (!value) return null;
  const normalized = value.startsWith("//") ? `https:${value}` : value;
  try {
    return new URL(normalized, baseUrl).href;
  } catch {
    return null;
  }
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => {
    if (Array.isArray(item)) return item.length > 0;
    return item !== null && item !== undefined && item !== "";
  }));
}

export function isJdProductUrl(url) {
  try {
    const parsed = new URL(url);
    return /(^|\.)jd\.com$/i.test(parsed.hostname) && /^\/\d+(?:\.html)?\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function extractJdSkuId(url) {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/(\d+)(?:\.html)?\/?$/i);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

function isJdVerificationPage(html) {
  return /京东验证|JDR_shields|risk\/static|安全验证/.test(html);
}

function readMeta($, selector) {
  return cleanText($(selector).attr("content") || "");
}

function readJdTitle($) {
  return cleanText(
    $(".sku-name").first().text()
    || $("#name h1").first().text()
    || $("h1").first().text()
    || readMeta($, 'meta[property="og:title"]')
    || $("title").first().text()
  ).replace(/\s*[-_]\s*京东.*$/i, "");
}

function readJdImage($, sourceUrl) {
  const candidates = [
    $("#spec-img").attr("data-origin"),
    $("#spec-img").attr("src"),
    $(".preview img").first().attr("data-origin"),
    $(".preview img").first().attr("src"),
    readMeta($, 'meta[property="og:image"]')
  ];
  return candidates.map((candidate) => absoluteUrl(candidate, sourceUrl)).find(Boolean) || null;
}

function readJdSpecs($) {
  const specs = {};
  $(".parameter2 li, #parameter2 li, .p-parameter li").each((_, item) => {
    const raw = cleanText($(item).attr("title") || $(item).text());
    const match = raw.match(/^([^：:]+)[：:]\s*(.+)$/);
    if (match) specs[cleanText(match[1])] = cleanText(match[2]);
  });

  $(".Ptable-item dl, .ptable-item dl").each((_, list) => {
    const key = cleanText($(list).find("dt").first().text());
    const value = cleanText($(list).find("dd").first().text());
    if (key && value) specs[key] = value;
  });

  return compactObject(specs);
}

function readJdBrand(specs, title) {
  return specs["品牌"] || specs.Brand || title.match(/^([\u4e00-\u9fa5A-Za-z0-9]+)/)?.[1] || null;
}

function normalizeJdSpecKeys(specs) {
  const normalized = { ...specs };
  if (specs["续航时间"] || specs["续航"] || specs["电池续航"]) {
    normalized.batteryLife = specs["续航时间"] || specs["续航"] || specs["电池续航"];
  }
  if (specs["防水等级"] || specs["防水"]) {
    normalized.waterResistance = specs["防水等级"] || specs["防水"];
  }
  if (specs["蓝牙"] || specs["连接方式"] || specs["无线连接"]) {
    normalized.connectivity = specs["蓝牙"] || specs["连接方式"] || specs["无线连接"];
  }
  return compactObject(normalized);
}

function buildVerificationResult(url, skuId) {
  const purchaseUrl = skuId ? `https://item.jd.com/${skuId}.html` : url;
  return {
    sourceUrl: url,
    sourceType: "commerce",
    brand: "京东",
    model: skuId || null,
    skuId,
    nameZh: skuId ? `京东商品 ${skuId}` : "京东商品",
    nameEn: skuId ? `JD Product ${skuId}` : "JD Product",
    deviceType: "other",
    bodyPart: "unknown",
    usagePositionLabel: "未知位置",
    metrics: [],
    functionPoints: [],
    coverage: skuId ? `京东商品 SKU ${skuId}` : "京东商品",
    precision: "京东页面触发验证，已提取 SKU，商品详情需通过可访问页面或后续接口补全。",
    price: null,
    currency: null,
    imageUrl: null,
    purchaseUrl,
    releasedAt: null,
    specs: compactObject({ skuId }),
    confidence: {
      overall: 0.25,
      fields: {
        nameZh: skuId ? 0.4 : 0.2,
        brand: 0.2,
        deviceType: 0.1,
        bodyPart: 0,
        metrics: 0,
        specs: skuId ? 0.4 : 0,
        price: 0
      }
    },
    warnings: [
      "京东页面触发验证，无法直接读取商品详情。",
      "已从 URL 提取京东 SKU，可手动补充或后续接入可访问的京东商品接口。"
    ],
    rawEvidence: {
      title: "京东验证",
      matchedTerms: skuId ? [`sku:${skuId}`] : []
    }
  };
}

export function collectJdProductFromHtml({ url, html }) {
  const skuId = extractJdSkuId(url);
  if (isJdVerificationPage(html)) {
    return buildVerificationResult(url, skuId);
  }

  const $ = cheerio.load(html);
  const title = readJdTitle($);
  const imageUrl = readJdImage($, url);
  const rawSpecs = readJdSpecs($);
  const specs = normalizeJdSpecKeys(rawSpecs);
  const brand = readJdBrand(rawSpecs, title);
  const description = cleanText(
    readMeta($, 'meta[name="description"]')
    || readMeta($, 'meta[property="og:description"]')
    || $(".news").first().text()
  );

  const specText = Object.entries(rawSpecs).map(([key, value]) => `${key} ${value}`).join("\n");
  const page = {
    sourceUrl: url,
    title,
    headings: [title].filter(Boolean),
    meta: {
      ogTitle: readMeta($, 'meta[property="og:title"]'),
      ogDescription: readMeta($, 'meta[property="og:description"]'),
      description
    },
    productJsonLd: {
      name: title,
      brand,
      price: null,
      currency: null,
      description
    },
    visibleText: cleanText(`${title} ${description} ${$("body").text()}`),
    specText,
    imageUrl,
    purchaseUrl: skuId ? `https://item.jd.com/${skuId}.html` : url
  };

  const result = normalizeWearableProduct(page);
  return {
    ...result,
    sourceType: "commerce",
    brand: brand || result.brand,
    nameEn: result.nameEn === "Mi Band" ? (skuId ? `JD Product ${skuId}` : "JD Product") : result.nameEn,
    skuId,
    imageUrl: result.imageUrl || imageUrl,
    specs: compactObject({
      skuId,
      ...specs
    }),
    warnings: [
      ...result.warnings,
      "京东商品页字段为电商页尽力解析，价格和库存可能需要后续接口补全。"
    ].filter(Boolean),
    rawEvidence: {
      ...result.rawEvidence,
      matchedTerms: [...new Set([...(result.rawEvidence?.matchedTerms || []), skuId ? `sku:${skuId}` : null].filter(Boolean))]
    }
  };
}
