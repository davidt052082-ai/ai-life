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

test("requireAdmin rejects unconfigured and non-admin requests", async () => {
  const { requireAdmin } = await import("../src/auth/middleware.js");

  const unconfigured = await runMiddleware(requireAdmin({ adminEmail: "" }), { user: { isAdmin: true } });
  assert.equal(unconfigured.statusCode, 503);
  assert.equal(unconfigured.body.error, "ADMIN_NOT_CONFIGURED");

  const member = await runMiddleware(requireAdmin({ adminEmail: "owner@example.com" }), { user: { isAdmin: false } });
  assert.equal(member.statusCode, 403);
  assert.equal(member.body.error, "ADMIN_REQUIRED");
});

test("admin router exposes group, membership, and project grant routes", async () => {
  const { createAdminRouter } = await import("../src/routes/adminRoutes.js");
  const router = createAdminRouter({
    repository: {},
    sessionService: {},
    adminEmail: "owner@example.com"
  });
  const paths = router.stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods)[0]} ${layer.route.path}`);

  assert.deepEqual(paths, [
    "get /overview",
    "get /users",
    "post /groups",
    "patch /groups/:groupId",
    "delete /groups/:groupId",
    "put /groups/:groupId/members/:userId",
    "delete /groups/:groupId/members/:userId",
    "put /groups/:groupId/projects/:projectId",
    "delete /groups/:groupId/projects/:projectId"
  ]);
});
