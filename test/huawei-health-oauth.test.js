import test from "node:test";
import assert from "node:assert/strict";
import { buildAuthorizationUrl, tokenForm } from "../src/integrations/huawei-health/oauth.js";

test("authorization URL requests offline access", () => {
  const url = new URL(buildAuthorizationUrl({ clientId: "client", redirectUri: "https://ai-life.top/api/integrations/huawei/callback", state: "abc", scopes: ["openid", "scope.read"] }));
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("state"), "abc");
  assert.equal(url.searchParams.get("scope"), "openid scope.read");
});

test("token form distinguishes code exchange and refresh", () => {
  assert.match(tokenForm({ grantType: "authorization_code", code: "code", config: { clientId: "id", clientSecret: "secret", redirectUri: "https://callback" } }).toString(), /grant_type=authorization_code/);
  assert.match(tokenForm({ grantType: "refresh_token", refreshToken: "refresh", config: { clientId: "id", clientSecret: "secret", redirectUri: "https://callback" } }).toString(), /refresh_token=refresh/);
});
