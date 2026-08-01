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

test("successful group and access changes emit non-blocking admin analytics events", async () => {
  const { createAdminRouter } = await import("../src/routes/adminRoutes.js");
  const recorded = [];
  const router = createAdminRouter({
    repository: {
      createGroup: async (input) => input,
      addMember: async () => {},
      grantProject: async () => {}
    },
    sessionService: {},
    adminEmail: "owner@example.com",
    analytics: { record: async (event) => recorded.push(event) }
  });
  const group = router.stack.find((layer) => layer.route?.path === "/groups" && layer.route.methods.post).route.stack.at(-1).handle;
  const member = router.stack.find((layer) => layer.route?.path === "/groups/:groupId/members/:userId").route.stack.at(-1).handle;
  const project = router.stack.find((layer) => layer.route?.path === "/groups/:groupId/projects/:projectId").route.stack.at(-1).handle;
  const uuid = "5c89ac08-f7c3-43cb-8e04-8a6aa0488bed";

  assert.equal((await invoke(group, { user: { id: uuid }, body: { name: "测试组", description: "说明" } })).statusCode, 201);
  assert.equal((await invoke(member, { user: { id: uuid }, params: { groupId: uuid, userId: "8c59b238-d1b7-4d67-b8fe-dfa78b11b1af" } })).statusCode, 204);
  assert.equal((await invoke(project, { user: { id: uuid }, params: { groupId: uuid, projectId: "8c59b238-d1b7-4d67-b8fe-dfa78b11b1af" } })).statusCode, 204);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(recorded.map((event) => event.eventType), ["admin_group_create", "admin_membership_change", "admin_project_access_change"]);
  assert.deepEqual(recorded.slice(1).map((event) => event.properties.operation), ["grant", "grant"]);
});

async function invoke(handler, req) {
  const result = { statusCode: 200, body: null };
  const res = { status(code) { result.statusCode = code; return this; }, json(body) { result.body = body; return this; }, end() { return this; } };
  await handler(req, res);
  return result;
}
