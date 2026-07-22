import { CollectorError } from "./errors.js";

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./
];

function isPrivate172(hostname) {
  const match = hostname.match(/^172\.(\d{1,3})\./);
  if (!match) return false;
  const secondOctet = Number(match[1]);
  return secondOctet >= 16 && secondOctet <= 31;
}

function isUnsafeHostname(hostname) {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (normalized === "::1") return true;
  if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(normalized))) return true;
  return isPrivate172(normalized);
}

export function validatePublicProductUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new CollectorError("INVALID_URL", "URL 格式不合法。", { status: 400 });
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new CollectorError("INVALID_URL", "只支持 http 或 https 产品网址。", { status: 400 });
  }

  if (isUnsafeHostname(url.hostname)) {
    throw new CollectorError("INVALID_URL", "不允许采集本机、内网或私有地址。", { status: 400 });
  }

  return url;
}
