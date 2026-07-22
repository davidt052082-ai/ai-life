import * as cheerio from "cheerio";

function cleanText(value = "") {
  return value.replace(/\s+/g, " ").trim();
}

function absoluteUrl(value, baseUrl) {
  if (!value) return null;
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return null;
  }
}

function readMeta($, selector) {
  return cleanText($(selector).attr("content") || "");
}

function normalizeJsonLdBrand(brand) {
  if (!brand) return null;
  if (typeof brand === "string") return brand;
  if (typeof brand.name === "string") return brand.name;
  return null;
}

function readProductJsonLd($) {
  const scripts = $('script[type="application/ld+json"]').toArray();
  for (const script of scripts) {
    const raw = $(script).text();
    try {
      const parsed = JSON.parse(raw);
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      const product = entries.flatMap((entry) => {
        if (Array.isArray(entry["@graph"])) return entry["@graph"];
        return [entry];
      }).find((entry) => {
        const type = entry?.["@type"];
        return type === "Product" || (Array.isArray(type) && type.includes("Product"));
      });

      if (!product) continue;

      const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
      return {
        name: cleanText(product.name || ""),
        brand: cleanText(normalizeJsonLdBrand(product.brand) || ""),
        image: Array.isArray(product.image) ? product.image[0] : product.image,
        price: offers?.price ? String(offers.price) : null,
        currency: offers?.priceCurrency || null,
        url: offers?.url || product.url || null,
        description: cleanText(product.description || "")
      };
    } catch {
      continue;
    }
  }
  return {};
}

function extractSpecs($) {
  const rows = [];

  $("table tr").each((_, row) => {
    const cells = $(row).find("th,td").toArray().map((cell) => cleanText($(cell).text())).filter(Boolean);
    if (cells.length >= 2) rows.push(cells.join(" "));
  });

  $("dl").each((_, list) => {
    const terms = $(list).find("dt").toArray();
    for (const term of terms) {
      const key = cleanText($(term).text());
      const value = cleanText($(term).next("dd").text());
      if (key && value) rows.push(`${key} ${value}`);
    }
  });

  return rows.join("\n");
}

function findPurchaseUrl($, baseUrl, productJsonLd) {
  const fromJsonLd = absoluteUrl(productJsonLd.url, baseUrl);
  if (fromJsonLd) return fromJsonLd;

  const purchaseLink = $("a").toArray().find((link) => /購買|购买|立即|buy|shop/i.test(cleanText($(link).text())));
  return purchaseLink ? absoluteUrl($(purchaseLink).attr("href"), baseUrl) : baseUrl;
}

export function extractPageData(html, sourceUrl) {
  const $ = cheerio.load(html);
  const productJsonLd = readProductJsonLd($);
  const ogImage = readMeta($, 'meta[property="og:image"]');

  $("script, style, noscript, svg").remove();

  const headings = $("h1,h2,h3").toArray().map((node) => cleanText($(node).text())).filter(Boolean);
  const visibleText = cleanText($("body").text());
  const specText = extractSpecs($);

  return {
    sourceUrl,
    title: cleanText($("title").first().text()),
    headings,
    meta: {
      ogTitle: readMeta($, 'meta[property="og:title"]'),
      ogDescription: readMeta($, 'meta[property="og:description"]'),
      description: readMeta($, 'meta[name="description"]')
    },
    productJsonLd,
    visibleText,
    specText,
    imageUrl: absoluteUrl(productJsonLd.image, sourceUrl) || absoluteUrl(ogImage, sourceUrl),
    purchaseUrl: findPurchaseUrl($, sourceUrl, productJsonLd)
  };
}
