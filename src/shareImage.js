import { CollectorError } from "./product-collector/errors.js";

const EXPORT_STYLE = `
  <style>
    .scheme-section,
    .action-dialog,
    .share-buttons,
    .share-actions {
      display: none !important;
    }

    body {
      background: #02070d !important;
    }
  </style>
`;

async function loadChromium() {
  try {
    const playwright = await import("playwright");
    return playwright.chromium;
  } catch (error) {
    throw new CollectorError(
      "SHARE_IMAGE_UNAVAILABLE",
      "分享图片需要安装 Playwright。请运行 npm install 后重试。",
      { status: 501 }
    );
  }
}

function injectExportStyle(html) {
  if (html.includes("</head>")) {
    return html.replace("</head>", `${EXPORT_STYLE}</head>`);
  }
  return `${EXPORT_STYLE}${html}`;
}

export async function renderShareImagePng(html, options = {}) {
  if (typeof html !== "string" || !html.trim()) {
    throw new CollectorError("INVALID_SHARE_HTML", "缺少可生成图片的页面内容。", { status: 400 });
  }

  const chromium = options.chromium || await loadChromium();
  const launchOptions = [
    { channel: "chrome", headless: true },
    { headless: true }
  ];
  let browser = null;
  let lastError = null;

  for (const launchOption of launchOptions) {
    try {
      browser = await chromium.launch(launchOption);
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!browser) {
    throw new CollectorError(
      "SHARE_IMAGE_BROWSER_FAILED",
      `无法启动图片生成浏览器。${lastError?.message ? ` 原始错误：${lastError.message.split("\n")[0]}` : ""}`,
      { status: 501 }
    );
  }

  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1800 },
      deviceScaleFactor: 1
    });
    await page.setContent(injectExportStyle(html), { waitUntil: "networkidle" });
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.querySelector(".scheme-section")?.remove();
      document.querySelectorAll(".action-dialog").forEach((item) => item.remove());
    });
    const target = page.locator("main").first();
    return await target.screenshot({
      type: "png",
      animations: "disabled"
    });
  } finally {
    await browser.close();
  }
}
