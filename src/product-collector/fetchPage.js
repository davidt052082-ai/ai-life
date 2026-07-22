import { CollectorError } from "./errors.js";

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_HTML_CHARS = 1_500_000;

function getHeader(headers, name) {
  if (typeof headers?.get === "function") return headers.get(name);
  if (headers instanceof Map) return headers.get(name);
  return null;
}

export async function fetchProductPage(url, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "user-agent": "Mozilla/5.0 (compatible; AI-Life-Wearable-Collector/0.1)"
      }
    });

    if (!response.ok) {
      const code = response.status === 401 || response.status === 403
        ? "BLOCKED_OR_LOGIN_REQUIRED"
        : "COLLECT_FAILED";
      throw new CollectorError(code, "目标页面无法访问或拒绝采集。", { status: response.status === 403 ? 403 : 502 });
    }

    const contentType = getHeader(response.headers, "content-type") || "";
    if (contentType && !/text\/html|application\/xhtml\+xml|application\/xml/i.test(contentType)) {
      throw new CollectorError("COLLECT_FAILED", "目标 URL 返回的不是 HTML 页面。", { status: 415 });
    }

    const html = await response.text();
    if (html.length > MAX_HTML_CHARS) {
      throw new CollectorError("CONTENT_TOO_LARGE", "页面内容超过最大采集限制。", { status: 413 });
    }
    if (html.trim().length < 80) {
      throw new CollectorError("NO_PRODUCT_SIGNAL", "页面内容为空或缺少产品信息。", { status: 422 });
    }

    return html;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new CollectorError("FETCH_TIMEOUT", "页面请求超时。", { status: 504 });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
