import test from "node:test";
import assert from "node:assert/strict";

test("registerUser normalizes the email, joins the default group, and signs in", async () => {
  const { createAuthRouter } = await import("../src/routes/authRoutes.js");
  const calls = [];
  const router = createAuthRouter({
    repository: {
      registerUser: async (input) => {
        calls.push(input);
        return { id: input.id, email: input.email, displayName: input.displayName };
      },
      findUserByEmail: async () => null
    },
    sessionService: {
      signIn: async (_res, userId) => calls.push({ signedIn: userId }),
      getCurrentUser: async () => null,
      signOut: async () => {}
    },
    defaultGroupCode: "default",
    adminEmail: "test@example.com"
  });
  const handler = router.stack.find((layer) => layer.route?.path === "/register").route.stack.at(-1).handle;
  const response = await invoke(handler, {
    body: { email: "  Test@Example.COM ", displayName: "测试用户", password: "12345678" }
  });

  assert.equal(response.statusCode, 201);
  assert.equal(calls[0].email, "test@example.com");
  assert.equal(calls[0].defaultGroupCode, "default");
  assert.equal(calls[0].defaultProjectCode, undefined);
  assert.equal(calls[0].isAdmin, true);
  assert.equal(calls[1].signedIn, calls[0].id);
});

test("successful registration and login record lifecycle events without affecting responses", async () => {
  const { createAuthRouter } = await import("../src/routes/authRoutes.js");
  const { hashPassword } = await import("../src/auth/password.js");
  const recorded = [];
  const user = { id: "5c89ac08-f7c3-43cb-8e04-8a6aa0488bed", email: "member@example.com", displayName: "成员", passwordHash: await hashPassword("12345678") };
  const router = createAuthRouter({
    repository: { registerUser: async () => user, findUserByEmail: async () => user },
    sessionService: { signIn: async () => {}, getCurrentUser: async () => null, signOut: async () => {} },
    defaultGroupCode: "default",
    analytics: { record: async (event) => recorded.push(event) }
  });
  const register = router.stack.find((layer) => layer.route?.path === "/register").route.stack.at(-1).handle;
  const login = router.stack.find((layer) => layer.route?.path === "/login").route.stack.at(-1).handle;

  const registered = await invoke(register, { body: { email: "member@example.com", displayName: "成员", password: "12345678" } });
  const loggedIn = await invoke(login, { body: { email: "member@example.com", password: "12345678" } });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(registered.statusCode, 201);
  assert.equal(loggedIn.statusCode, 200);
  assert.deepEqual(recorded.map((event) => event.eventType), ["sign_up", "login"]);
  assert.equal(recorded[0].userId, user.id);
});

async function invoke(handler, req) {
  const result = { statusCode: 200, body: null };
  const res = {
    status(code) {
      result.statusCode = code;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
    end() {
      return this;
    }
  };
  await handler(req, res);
  return result;
}
