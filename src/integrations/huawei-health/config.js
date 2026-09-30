function positiveInteger(value, name, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${name} must be a positive integer.`);
  return number;
}

export function readHuaweiConfig(env = process.env) {
  if (env.HUAWEI_HEALTH_ENABLED !== "true") return { enabled: false };
  for (const name of ["HUAWEI_CLIENT_ID", "HUAWEI_CLIENT_SECRET", "HUAWEI_REDIRECT_URI", "HUAWEI_TOKEN_ENCRYPTION_KEY"]) {
    if (!String(env[name] || "").trim()) throw new Error(`${name} is required when Huawei Health is enabled.`);
  }
  if (Buffer.from(env.HUAWEI_TOKEN_ENCRYPTION_KEY, "base64").length !== 32) {
    throw new Error("HUAWEI_TOKEN_ENCRYPTION_KEY must decode to 32 bytes.");
  }
  return {
    enabled: true,
    clientId: env.HUAWEI_CLIENT_ID,
    clientSecret: env.HUAWEI_CLIENT_SECRET,
    redirectUri: env.HUAWEI_REDIRECT_URI,
    tokenKey: env.HUAWEI_TOKEN_ENCRYPTION_KEY,
    apiBase: env.HUAWEI_HEALTH_API_BASE || "https://health-api.cloud.huawei.com/healthkit/v2",
    tokenUrl: env.HUAWEI_OAUTH_TOKEN_URL || "https://oauth-login.cloud.huawei.com/oauth2/v3/token",
    intervalHours: positiveInteger(env.HUAWEI_SYNC_INTERVAL_HOURS, "HUAWEI_SYNC_INTERVAL_HOURS", 4),
    lookbackDays: positiveInteger(env.HUAWEI_SYNC_LOOKBACK_DAYS, "HUAWEI_SYNC_LOOKBACK_DAYS", 3),
    initialDays: positiveInteger(env.HUAWEI_INITIAL_SYNC_DAYS, "HUAWEI_INITIAL_SYNC_DAYS", 30)
    ,scopes: String(env.HUAWEI_HEALTH_SCOPES || "").split(/[\s,]+/).filter(Boolean)
  };
}
