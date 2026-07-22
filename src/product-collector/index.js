import { CollectorError } from "./errors.js";
import { validatePublicProductUrl } from "./urlSafety.js";
import { fetchProductPage } from "./fetchPage.js";
import { extractPageData } from "./extractPageData.js";
import { collectJdProductFromHtml, isJdProductUrl } from "./jdProduct.js";
import { normalizeWearableProduct } from "./normalizeWearable.js";

export async function collectProductFromHtml({ url, html }) {
  const safeUrl = validatePublicProductUrl(url);
  if (isJdProductUrl(safeUrl.href)) {
    return collectJdProductFromHtml({ url: safeUrl.href, html });
  }

  const page = extractPageData(html, safeUrl.href);
  const result = normalizeWearableProduct(page);

  const hasProductSignal = result.deviceType !== "other" || result.metrics.length > 0;
  if (!hasProductSignal) {
    throw new CollectorError("NO_PRODUCT_SIGNAL", "未识别到智能穿戴产品信号。", { status: 422 });
  }

  return result;
}

export async function collectProductFromUrl(url, options = {}) {
  const safeUrl = validatePublicProductUrl(url);
  const html = await fetchProductPage(safeUrl.href, options);
  return collectProductFromHtml({ url: safeUrl.href, html });
}
