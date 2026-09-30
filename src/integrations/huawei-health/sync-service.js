import { randomUUID } from "node:crypto";
import { decryptSecret } from "./crypto.js";
import { encryptSecret } from "./crypto.js";
import { requestToken } from "./oauth.js";

const DAY_MS = 86_400_000;
const COOLDOWN_MS = 5 * 60_000;

export function syncWindow({ connection = {}, now = () => new Date(), initialDays = 30, lookbackDays = 3 }) {
  const end = now();
  const last = connection.lastSuccessfulSyncAt ? new Date(connection.lastSuccessfulSyncAt) : null;
  const start = last && !Number.isNaN(last.valueOf())
    ? new Date(last.getTime() - lookbackDays * DAY_MS)
    : new Date(end.getTime() - initialDays * DAY_MS);
  return { start, end };
}

function syncError(code, status) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

export function createHuaweiSyncService({ repository, client, config, now = () => new Date(), decrypt = decryptSecret, encrypt = encryptSecret, refreshToken = requestToken }) {
  return {
    async syncUser({ userId, projectId, trigger }) {
      const connection = await repository.getConnection(userId);
      if (!connection || connection.status !== "connected") return { status: "skipped" };
      if (trigger === "manual" && connection.lastAttemptSyncAt && now().getTime() - new Date(connection.lastAttemptSyncAt).getTime() < COOLDOWN_MS) throw syncError("HUAWEI_SYNC_COOLDOWN", 429);
      const window = syncWindow({ connection, now, initialDays: config.initialDays, lookbackDays: config.lookbackDays });
      const runId = await repository.createSyncRun({ userId, projectId, trigger, windowStart: window.start, windowEnd: window.end, traceId: randomUUID() });
      try {
        let token = decrypt(connection.accessTokenEnc, config.tokenKey);
        const expiresAt = connection.accessTokenExpiresAt ? new Date(connection.accessTokenExpiresAt) : null;
        if (expiresAt && expiresAt.getTime() <= now().getTime() + 60_000) {
          const refreshed = await refreshToken({ grantType: "refresh_token", refreshToken: decrypt(connection.refreshTokenEnc, config.tokenKey), config });
          token = refreshed.accessToken;
          await repository.upsertConnection({ userId, projectId: connection.projectId || projectId, accessTokenEnc: encrypt(refreshed.accessToken, config.tokenKey), refreshTokenEnc: encrypt(refreshed.refreshToken || decrypt(connection.refreshTokenEnc, config.tokenKey), config.tokenKey), accessTokenExpiresAt: refreshed.expiresAt, grantedScopes: connection.grantedScopes || [] });
        }
        const result = await client.collectDaily({ token, window, timezone: config.timezone || "Asia/Shanghai", connection });
        const daily = result.daily || [];
        await repository.upsertSamples({ userId, projectId, samples: result.samples || [] });
        await repository.upsertDaily({ userId, projectId, rows: daily });
        if (result.workouts?.length) await repository.upsertWorkouts({ userId, projectId, workouts: result.workouts });
        const status = result.partial ? "partial" : "success";
        await repository.finishSyncRun({ id: runId, status, recordsRead: result.recordsRead || daily.length, recordsInserted: result.recordsInserted || daily.length, recordsUpdated: result.recordsUpdated || 0, errorCode: result.errorCode || null });
        await repository.markSyncSuccess(userId);
        return { status, window, recordsRead: result.recordsRead || daily.length };
      } catch (error) {
        if (error.code === "HUAWEI_REAUTH_REQUIRED" || error.code === "TOKEN_DECRYPT_FAILED") await repository.markReauthRequired(userId, error.code);
        await repository.markSyncFailure(userId, error.code || "HUAWEI_SYNC_FAILED");
        await repository.finishSyncRun({ id: runId, status: "failed", errorCode: error.code || "HUAWEI_SYNC_FAILED" });
        throw error;
      }
    }
  };
}
