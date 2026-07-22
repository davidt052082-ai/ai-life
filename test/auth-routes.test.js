import test from "node:test";
import assert from "node:assert/strict";

test("registerUser normalizes the email, grants the wearable project, and signs in", async () => {
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
    defaultProjectCode: "wearable-monitoring"
  });
  const handler = router.stack.find((layer) => layer.route?.path === "/register").route.stack.at(-1).handle;
  const response = await invoke(handler, {
    body: { email: "  Test@Example.COM ", displayName: "测试用户", password: "12345678" }
  });

  assert.equal(response.statusCode, 201);
  assert.equal(calls[0].email, "test@example.com");
  assert.equal(calls[0].defaultProjectCode, "wearable-monitoring");
  assert.equal(calls[1].signedIn, calls[0].id);
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
    }
  };
  await handler(req, res);
  return result;
}
