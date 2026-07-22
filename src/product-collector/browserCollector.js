import path from "node:path";
import { fileURLToPath } from "node:url";
import { CollectorError } from "./errors.js";
import { collectProductFromHtml } from "./index.js";
import { validatePublicProductUrl } from "./urlSafety.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_PROFILE_DIR = path.resolve(__dirname, "../../.collector-browser-profile");
const DEFAULT_BROWSER_CHANNEL = "chrome";

function buildBrowserLaunchError(error) {
  const detail = error?.message ? ` 原始错误：${error.message.split("\n")[0]}` : "";
  return new CollectorError(
    "BROWSER_COLLECTOR_UNAVAILABLE",
    `无法启动浏览器辅助抓取。已优先尝试本机 Chrome；如仍失败，请运行 npx playwright install chromium 后重试。${detail}`,
    { status: 501 }
  );
}

export function createBrowserProductCollector(options = {}) {
  let context = null;
  let page = null;
  const profileDir = options.profileDir || DEFAULT_PROFILE_DIR;
  const browserChannel = Object.hasOwn(options, "browserChannel") ? options.browserChannel : DEFAULT_BROWSER_CHANNEL;

  async function loadChromium() {
    if (options.chromium) return options.chromium;
    try {
      const playwright = await import("playwright");
      return playwright.chromium;
    } catch (error) {
      throw new CollectorError(
        "BROWSER_COLLECTOR_UNAVAILABLE",
        "浏览器辅助抓取需要安装 Playwright。请运行 npm install 后重试。",
        { status: 501 }
      );
    }
  }

  async function ensurePage() {
    if (page && !page.isClosed()) return page;
    const chromium = await loadChromium();
    const baseLaunchOptions = {
      headless: false,
      viewport: { width: 1360, height: 900 }
    };
    const launchAttempts = browserChannel
      ? [{ ...baseLaunchOptions, channel: browserChannel }, baseLaunchOptions]
      : [baseLaunchOptions];
    let lastError = null;

    for (const launchOptions of launchAttempts) {
      try {
        context = await chromium.launchPersistentContext(profileDir, launchOptions);
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!context) {
      throw buildBrowserLaunchError(lastError);
    }

    page = context.pages()[0] || await context.newPage();
    return page;
  }

  return {
    async openProductPage(inputUrl) {
      const url = validatePublicProductUrl(inputUrl).href;
      const activePage = await ensurePage();
      await activePage.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      return {
        opened: true,
        url,
        currentUrl: activePage.url(),
        title: await activePage.title(),
        message: "已打开浏览器。请在浏览器中登录或完成验证，然后回到本工具点击“登录后抓取”。"
      };
    },

    async collectCurrentProduct() {
      const activePage = await ensurePage();
      const currentUrl = activePage.url();
      const html = await activePage.content();
      return collectProductFromHtml({ url: currentUrl, html });
    },

    async close() {
      await context?.close();
      context = null;
      page = null;
    }
  };
}
