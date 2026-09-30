const AUTHORIZE_URL = "https://oauth-login.cloud.huawei.com/oauth2/v3/authorize";

export function buildAuthorizationUrl({ clientId, redirectUri, state, scopes }) {
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({ response_type: "code", access_type: "offline", client_id: clientId, redirect_uri: redirectUri, state, scope: [...new Set(["openid", ...scopes])].join(" ") }).toString();
  return url.toString();
}

export function tokenForm({ grantType, code, refreshToken, config }) {
  const form = new URLSearchParams({ grant_type: grantType, client_id: config.clientId, client_secret: config.clientSecret });
  if (grantType === "authorization_code") { form.set("code", code); form.set("redirect_uri", config.redirectUri); }
  if (grantType === "refresh_token") form.set("refresh_token", refreshToken);
  return form;
}

export async function requestToken({ grantType, code, refreshToken, config, fetchImpl = fetch }) {
  const response = await fetchImpl(config.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: tokenForm({ grantType, code, refreshToken, config }) });
  if (!response.ok) { const error = new Error("Huawei OAuth token request failed."); error.status = response.status; throw error; }
  const body = await response.json();
  return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: new Date(Date.now() + Number(body.expires_in || 0) * 1000), openId: body.open_id || null };
}
