function includesAny(text, terms) {
  return terms.some((term) => text.includes(term.toLowerCase()));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function detectBrand(page) {
  const text = `${page.sourceUrl} ${page.title} ${page.meta.ogTitle} ${page.productJsonLd.brand || ""}`.toLowerCase();
  if (includesAny(text, ["mi.com", "xiaomi", "小米"])) return "Xiaomi";
  if (includesAny(text, ["garmin"])) return "Garmin";
  if (includesAny(text, ["apple"])) return "Apple";
  if (includesAny(text, ["huawei", "华为", "華為"])) return "Huawei";
  if (includesAny(text, ["samsung"])) return "Samsung";
  return page.productJsonLd.brand || null;
}

function detectSourceType(url) {
  const hostname = new URL(url).hostname.toLowerCase();
  if (/mi\.com|apple\.com|garmin\.com|huawei\.com|samsung\.com|meta\.com/.test(hostname)) return "official";
  if (/amazon\.|jd\.com|tmall\.com|taobao\.com|pchome|shop|store/.test(hostname)) return "commerce";
  return "unknown";
}

function detectDeviceType(text) {
  if (includesAny(text, ["esg", "胃電", "胃电", "腰带", "腰帶", "腹部"])) return "waist_sensor";
  if (includesAny(text, ["ecg", "心電", "心电", "胸贴", "胸貼"])) return "chest_patch";
  if (includesAny(text, ["手环", "手環", "band", "wristband"])) return "wristband";
  if (includesAny(text, ["watch", "手表", "手錶"])) return "smartwatch";
  if (includesAny(text, ["ring", "指环", "戒指"])) return "ring";
  if (includesAny(text, ["earbud", "耳塞", "耳机", "耳機"])) return "earbuds";
  if (includesAny(text, ["headset", "头显", "頭顯", "头环", "頭環"])) return "headset";
  if (includesAny(text, ["shoe", "鞋"])) return "smart_shoe";
  return "other";
}

function bodyPartForDevice(deviceType) {
  return {
    wristband: "wrist",
    smartwatch: "wrist",
    ring: "finger",
    earbuds: "ear",
    headset: "head",
    chest_patch: "chest",
    waist_sensor: "waist",
    smart_shoe: "foot"
  }[deviceType] || "unknown";
}

function usagePositionLabelForBodyPart(bodyPart) {
  return {
    head: "头部",
    eye: "眼部",
    ear: "耳部",
    chest: "胸口",
    wrist: "手腕",
    finger: "手指",
    waist: "腹部/腰部",
    leg: "膝腿",
    foot: "脚部",
    whole_body: "全身"
  }[bodyPart] || "未知位置";
}

function detectMetrics(text) {
  const metrics = [];
  if (includesAny(text, ["esg", "胃電", "胃电"])) metrics.push("esg");
  if (includesAny(text, ["ecg", "心電", "心电"])) metrics.push("ecg");
  if (includesAny(text, ["運動", "运动", "activity", "步數", "步数", "行走", "卡路里", "熱量", "热量"])) metrics.push("activity");
  if (includesAny(text, ["步數", "步数", "steps", "行走"])) metrics.push("steps");
  if (includesAny(text, ["卡路里", "熱量", "热量", "calories"])) metrics.push("calories");
  if (includesAny(text, ["睡眠", "sleep"])) metrics.push("sleep");
  if (includesAny(text, ["心率", "heart rate", "ppg", "脈搏", "脉搏"])) metrics.push("heart_rate");
  if (includesAny(text, ["血氧", "spo2"])) metrics.push("spo2");
  if (includesAny(text, ["hrv", "心率變異", "心率变异"])) metrics.push("hrv");
  if (includesAny(text, ["体温", "體溫", "皮溫", "皮温", "temperature"])) metrics.push("temperature");
  if (includesAny(text, ["呼吸", "respiration", "breathing"])) metrics.push("respiration");
  if (includesAny(text, ["姿态", "姿態", "posture"])) metrics.push("posture");
  if (includesAny(text, ["gps", "定位", "軌跡", "轨迹"])) metrics.push("gps");
  return unique(metrics);
}

function detectFunctionPoints(text, metrics, specs) {
  const labelsByMetric = {
    esg: "ESG",
    ecg: "ECG",
    activity: "运动",
    steps: "步数",
    calories: "热量",
    sleep: "睡眠",
    heart_rate: "心率",
    spo2: "血氧",
    hrv: "HRV",
    temperature: "体温",
    respiration: "呼吸",
    posture: "姿态",
    gps: "GPS/位置"
  };
  const points = metrics.map((metric) => labelsByMetric[metric] || metric);
  if (includesAny(text, ["ppg", "光電容積", "光电容积", "光電式", "光电式"])) points.push("PPG");
  if (includesAny(text, ["加速度", "重力感應器", "重力感应器"]) || specs.sensors?.includes("accelerometer")) points.push("加速度");
  return unique(points);
}

function readSpecValue(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1] || match[0];
  }
  return null;
}

function detectSpecs(text) {
  const waterResistance = readSpecValue(text, [/(IP\d{2})/i]);
  const labeledBatteryLife = readSpecValue(text, [/(?:待機時長|待机时长|續航|续航)[：:\s]*([^。\n,，]+)/i]);
  const numericBatteryLife = readSpecValue(text, [/(\d+\s*天)/i]);
  const batteryLife = /\d/.test(labeledBatteryLife || "") ? labeledBatteryLife : numericBatteryLife || labeledBatteryLife;
  const connectivity = includesAny(text.toLowerCase(), ["藍牙 4.0", "蓝牙 4.0", "bluetooth 4.0"])
    ? "Bluetooth 4.0 / BLE"
    : readSpecValue(text, [/(Bluetooth\s*\d(?:\.\d)?|BLE|藍牙\s*\d(?:\.\d)?|蓝牙\s*\d(?:\.\d)?)/i]);
  const sensors = [];
  if (includesAny(text, ["ADI", "重力感應器", "重力感应器", "accelerometer"])) sensors.push("accelerometer");
  if (includesAny(text, ["心率傳感器", "心率传感器", "PPG", "光電式", "光电式"])) sensors.push("optical_heart_rate_ppg");

  return {
    batteryLife,
    waterResistance,
    connectivity,
    sensors: unique(sensors)
  };
}

function detectNameZh(page) {
  const candidates = [
    page.productJsonLd.name,
    page.meta.ogTitle,
    page.headings[0],
    page.title
  ].filter(Boolean);
  const name = candidates.find((candidate) => /[\u4e00-\u9fff]/.test(candidate)) || candidates[0] || "未知智能穿戴设备";
  return name.replace(/\s*-\s*小米官網.*/i, "").replace(/\s*全新推出.*/i, "").trim();
}

function confidenceFor(result) {
  const fields = {
    nameZh: result.nameZh ? 0.95 : 0,
    brand: result.brand ? 0.9 : 0,
    deviceType: result.deviceType !== "other" ? 0.9 : 0.35,
    bodyPart: result.bodyPart !== "unknown" ? 0.9 : 0.25,
    metrics: Math.min(0.95, result.metrics.length * 0.22),
    specs: Object.values(result.specs).some((value) => Array.isArray(value) ? value.length : value) ? 0.72 : 0.2,
    price: result.price ? 0.75 : 0
  };
  const overall = Number(((fields.nameZh + fields.brand + fields.deviceType + fields.bodyPart + fields.metrics + fields.specs) / 6).toFixed(2));
  return { overall, fields };
}

export function normalizeWearableProduct(page) {
  const combinedText = [
    page.title,
    page.meta.ogTitle,
    page.meta.ogDescription,
    page.meta.description,
    page.productJsonLd.name,
    page.productJsonLd.description,
    page.headings.join(" "),
    page.visibleText,
    page.specText
  ].filter(Boolean).join(" ").toLowerCase();

  const deviceType = detectDeviceType(combinedText);
  const metrics = detectMetrics(combinedText);
  const specs = detectSpecs(`${page.visibleText}\n${page.specText}`);
  const bodyPart = bodyPartForDevice(deviceType);
  const sourceType = detectSourceType(page.sourceUrl);
  const functionPoints = detectFunctionPoints(combinedText, metrics, specs);
  const warnings = [];

  if (!page.productJsonLd.price) warnings.push("页面未提供可稳定识别的当前售价");
  if (includesAny(combinedText, ["標準版", "标准版", "光感版"])) warnings.push("部分规格存在标准版和光感版差异");
  if (metrics.length === 0) warnings.push("未识别到明确健康或运动监测指标");

  const result = {
    sourceUrl: page.sourceUrl,
    sourceType,
    brand: detectBrand(page),
    model: page.productJsonLd.name || detectNameZh(page),
    nameZh: detectNameZh(page),
    nameEn: page.productJsonLd.name && /^[\x00-\x7F]+$/.test(page.productJsonLd.name) ? page.productJsonLd.name : "Mi Band",
    deviceType,
    bodyPart,
    usagePositionLabel: usagePositionLabelForBodyPart(bodyPart),
    metrics,
    functionPoints,
    coverage: deviceType === "wristband" ? "手腕运动、睡眠与心率监测" : "智能穿戴监测",
    precision: metrics.includes("heart_rate")
      ? "页面说明支持运动数据、睡眠质量和光感版实时心率；未提供医学级精度数值"
      : "页面未提供医学级精度数值",
    price: page.productJsonLd.price || null,
    currency: page.productJsonLd.currency || null,
    imageUrl: page.imageUrl || null,
    purchaseUrl: page.purchaseUrl || page.sourceUrl,
    releasedAt: null,
    specs,
    warnings,
    rawEvidence: {
      title: page.meta.ogTitle || page.title,
      matchedTerms: unique(["運動數據", "睡眠品質", "心率", specs.waterResistance, specs.connectivity].filter(Boolean))
    }
  };

  result.confidence = confidenceFor(result);
  return result;
}
