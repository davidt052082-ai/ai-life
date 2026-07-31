export const WEARABLE_PROJECT_CODE = "wearable-monitoring";
export const STUDY_PLAN_PROJECT_CODE = "study-plan";

function escapeXml(value) {
  return String(value || "项目").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;"
  })[character]);
}

function toBase64(value) {
  if (typeof Buffer !== "undefined") return Buffer.from(value, "utf8").toString("base64");
  return btoa(unescape(encodeURIComponent(value)));
}

function hashCode(value) {
  return [...String(value || "project")]
    .reduce((hash, character) => ((hash * 31) + character.codePointAt(0)) >>> 0, 2166136261);
}

function genericSvg(project) {
  const hue = 24 + (hashCode(project.code) % 250);
  const name = escapeXml(project.name || "项目");
  const tag = escapeXml((project.code || "PROJECT").slice(0, 18).toUpperCase());
  return `<svg class="project-cover" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 480" role="img" aria-label="${name}"><defs><linearGradient id="g" x1="0" x2="1"><stop stop-color="hsl(${hue} 62% 26%)"/><stop offset="1" stop-color="hsl(${(hue + 48) % 360} 70% 53%)"/></linearGradient></defs><rect width="960" height="480" fill="url(#g)"/><circle cx="790" cy="94" r="170" fill="#fff" opacity=".12"/><path d="M0 390Q200 280 430 405T960 335V480H0Z" fill="#fff" opacity=".13"/><text x="72" y="164" fill="#fff" font-family="Arial, PingFang SC, sans-serif" font-size="24" font-weight="700" letter-spacing="5">${tag}</text><text x="72" y="252" fill="#fff" font-family="Arial, PingFang SC, sans-serif" font-size="58" font-weight="700">${name}</text></svg>`;
}

function studyPlanSvg(project) {
  const name = escapeXml(project.name || "学习计划日历");
  return `<svg class="project-cover calendar" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 480" role="img" aria-label="${name}"><rect width="960" height="480" fill="#fff2e8"/><circle cx="830" cy="90" r="180" fill="#ffe0d3"/><rect x="194" y="74" width="572" height="334" rx="28" fill="#fffdf9" stroke="#f4c5b9" stroke-width="6"/><rect x="194" y="74" width="572" height="76" rx="28" fill="#ed8791"/><text x="244" y="121" fill="#fff" font-family="Arial, sans-serif" font-size="22" font-weight="700" letter-spacing="4">LEARNING PLAN</text><g fill="#f5d3ca"><rect x="244" y="188" width="74" height="46" rx="10"/><rect x="340" y="188" width="74" height="46" rx="10"/><rect x="436" y="188" width="74" height="46" rx="10"/></g><g fill="#d7e3ff"><rect x="532" y="188" width="74" height="46" rx="10"/><rect x="628" y="188" width="74" height="46" rx="10"/></g><g fill="#d9f0dc"><rect x="244" y="258" width="74" height="46" rx="10"/><rect x="340" y="258" width="74" height="46" rx="10"/></g><g fill="#f7e6b7"><rect x="436" y="258" width="74" height="46" rx="10"/><rect x="532" y="258" width="74" height="46" rx="10"/><rect x="628" y="258" width="74" height="46" rx="10"/></g><text x="244" y="366" fill="#65566b" font-family="Arial, PingFang SC, sans-serif" font-size="34" font-weight="700">${name}</text></svg>`;
}

export function generateProjectCover(project = {}) {
  const svg = project.code === STUDY_PLAN_PROJECT_CODE ? studyPlanSvg(project) : genericSvg(project);
  return `data:image/svg+xml;base64,${toBase64(svg)}`;
}
