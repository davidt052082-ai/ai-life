(() => {
  const visitorStorageKey = "ai-life.analytics.visitor-id";
  const sessionStorageKey = "ai-life.analytics.session-id";
  const endpoint = "/api/analytics/events";

  function fallbackUuid() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("").replace(
      /(.{8})(.{4})(.{4})(.{4})(.{12})/,
      "$1-$2-$3-$4-$5"
    );
  }

  function uuid() {
    return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : fallbackUuid();
  }

  function persistentId(storage, key) {
    try {
      const existing = storage.getItem(key);
      if (existing) return existing;
      const created = uuid();
      storage.setItem(key, created);
      return created;
    } catch {
      return uuid();
    }
  }

  const visitorId = persistentId(localStorage, visitorStorageKey);
  const sessionId = persistentId(sessionStorage, sessionStorageKey);

  function userAgentDetails() {
    const agent = navigator.userAgent || "";
    const platform = navigator.platform || "";
    const deviceType = /iPad|Tablet/i.test(agent) ? "tablet" : /Mobi|Android/i.test(agent) ? "mobile" : "desktop";
    const browserName = /Edg\//.test(agent) ? "Edge" : /Firefox\//.test(agent) ? "Firefox" : /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "unknown";
    const osName = /Windows/i.test(platform) ? "Windows" : /Mac/i.test(platform) ? "macOS" : /Android/i.test(agent) ? "Android" : /iPhone|iPad/i.test(agent) ? "iOS" : "unknown";
    return { deviceType, browserName, osName };
  }

  function utmParameters() {
    const parameters = new URLSearchParams(location.search);
    return {
      source: parameters.get("utm_source") || undefined,
      medium: parameters.get("utm_medium") || undefined,
      campaign: parameters.get("utm_campaign") || undefined,
      term: parameters.get("utm_term") || undefined,
      content: parameters.get("utm_content") || undefined
    };
  }

  function transmit(payload) {
    try {
      const body = JSON.stringify(payload);
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon?.(endpoint, blob)) return;
      void fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body
      }).catch(() => {});
    } catch {
      // Analytics must never interrupt the host page.
    }
  }

  function track(eventType, properties = {}) {
    const details = userAgentDetails();
    transmit({
      visitorId,
      sessionId,
      eventType,
      pagePath: location.pathname || "/",
      referrer: document.referrer || "",
      utm: utmParameters(),
      ...details,
      language: navigator.language || "",
      screen: { width: window.screen?.width || null, height: window.screen?.height || null },
      properties
    });
  }

  window.aiLifeAnalytics = { track };
  const trackPageView = () => track("page_view", { title: document.title.slice(0, 160) });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", trackPageView, { once: true });
  else trackPageView();
})();
