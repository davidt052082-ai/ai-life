import { createHash, randomBytes } from "node:crypto";
import { encryptSecret } from "./crypto.js";
import { buildAuthorizationUrl, requestToken } from "./oauth.js";

function serviceError(code, status, message = code) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function providerUserIdHash(openId) {
  return openId ? createHash("sha256").update(openId).digest("hex") : null;
}

export function createHuaweiHealthService({ config, repository, syncService, exchangeToken = requestToken, encrypt = encryptSecret, now = () => new Date() }) {
  const enabled = Boolean(config?.enabled);
  return {
    async status({ userId }) {
      if (!enabled) return { enabled: false, status: "disabled" };
      const connection = await repository.getConnection(userId);
      return {
        enabled: true,
        status: connection?.status || "disconnected",
        grantedScopes: connection?.grantedScopes || [],
        lastSuccessfulSyncAt: connection?.lastSuccessfulSyncAt || null,
        lastErrorCode: connection?.lastErrorCode || null
      };
    },
    async beginConnection({ userId, projectId, redirectPath = "/projects/health?tab=settings" }) {
      if (!enabled) throw serviceError("HUAWEI_DISABLED", 409, "华为健康接入尚未启用。");
      const state = randomBytes(24).toString("base64url");
      await repository.createOAuthState({ state, userId, projectId, redirectPath, expiresAt: new Date(now().getTime() + 10 * 60_000) });
      return buildAuthorizationUrl({ clientId: config.clientId, redirectUri: config.redirectUri, state, scopes: config.scopes || [] });
    },
    async completeConnection({ code, state }) {
      if (!enabled) throw serviceError("HUAWEI_DISABLED", 409, "华为健康接入尚未启用。");
      if (!code || !state) throw serviceError("HUAWEI_OAUTH_INVALID", 400, "授权响应无效。");
      const pending = await repository.consumeOAuthState(state);
      if (!pending) throw serviceError("HUAWEI_OAUTH_STATE_INVALID", 400, "授权已过期或已使用。");
      const token = await exchangeToken({ grantType: "authorization_code", code, config });
      if (!token.accessToken || !token.refreshToken) throw serviceError("HUAWEI_TOKEN_INVALID", 502, "华为授权未返回可用凭据。");
      await repository.upsertConnection({
        userId: pending.userId,
        projectId: pending.projectId,
        accessTokenEnc: encrypt(token.accessToken, config.tokenKey),
        refreshTokenEnc: encrypt(token.refreshToken, config.tokenKey),
        accessTokenExpiresAt: token.expiresAt,
        grantedScopes: config.scopes || [],
        providerUserIdHash: providerUserIdHash(token.openId)
      });
      void syncService.syncUser({ userId: pending.userId, projectId: pending.projectId, trigger: "initial" }).catch((error) => console.error("Huawei Health initial sync failed:", error.code || error.message));
      return { redirectPath: pending.redirectPath };
    },
    async requestManualSync({ userId, projectId }) {
      if (!enabled) throw serviceError("HUAWEI_DISABLED", 409, "华为健康接入尚未启用。");
      const connection = await repository.getConnection(userId);
      if (!connection || connection.status === "disconnected") throw serviceError("HUAWEI_NOT_CONNECTED", 409, "请先连接华为运动健康。");
      await syncService.syncUser({ userId, projectId, trigger: "manual" });
    },
    async disconnect({ userId }) {
      if (!enabled) return;
      await repository.deleteConnectionTokens(userId);
    }
  };
}
