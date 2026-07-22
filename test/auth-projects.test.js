import test from "node:test";
import assert from "node:assert/strict";

async function runMiddleware(middleware, req) {
  const result = { statusCode: 200, body: null, nextCalled: false };
  const res = {
    status(code) {
      result.statusCode = code;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    }
  };
  await middleware(req, res, () => {
    result.nextCalled = true;
  });
  return result;
}

test("passwords are hashed and verified without retaining plaintext", async () => {
  const { hashPassword, verifyPassword } = await import("../src/auth/password.js");
  const hash = await hashPassword("correct-horse-battery-staple");

  assert.notEqual(hash, "correct-horse-battery-staple");
  assert.equal(await verifyPassword("correct-horse-battery-staple", hash), true);
  assert.equal(await verifyPassword("wrong-password", hash), false);
});

test("requireProjectAccess returns 403 when the current user lacks a project grant", async () => {
  const { requireProjectAccess } = await import("../src/auth/middleware.js");
  const middleware = requireProjectAccess({
    findProjectAccess: async () => null
  });
  const result = await runMiddleware(middleware, {
    user: { id: "user-a" },
    params: { code: "wearable-monitoring" }
  });

  assert.equal(result.statusCode, 403);
  assert.equal(result.body.error, "PROJECT_ACCESS_DENIED");
  assert.equal(result.nextCalled, false);
});

test("requireUser returns 401 when the request has no active session", async () => {
  const { requireUser } = await import("../src/auth/middleware.js");
  const middleware = requireUser({ getCurrentUser: async () => null });
  const result = await runMiddleware(middleware, {});

  assert.equal(result.statusCode, 401);
  assert.equal(result.body.error, "AUTH_REQUIRED");
});
