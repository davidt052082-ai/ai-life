import { randomUUID } from "node:crypto";
import { Router } from "express";
import { hashPassword, verifyPassword } from "../auth/password.js";

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function publicUser(user) {
  return { id: user.id, email: user.email, displayName: user.displayName };
}

export function createAuthRouter({ repository, sessionService, defaultProjectCode }) {
  const router = Router();

  router.post("/register", async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const displayName = typeof req.body?.displayName === "string" ? req.body.displayName.trim() : "";
    const password = req.body?.password;
    if (!email || !email.includes("@") || !displayName) {
      res.status(400).json({ error: "INVALID_INPUT", message: "请填写有效的显示名、邮箱和密码。" });
      return;
    }

    try {
      const user = await repository.registerUser({
        id: randomUUID(),
        email,
        displayName,
        passwordHash: await hashPassword(password),
        defaultProjectCode
      });
      await sessionService.signIn(res, user.id);
      res.status(201).json({ user: publicUser(user) });
    } catch (error) {
      if (error.code === "23505") {
        res.status(409).json({ error: "EMAIL_ALREADY_REGISTERED", message: "该邮箱已经注册。" });
        return;
      }
      if (error.message === "密码至少需要 8 位。") {
        res.status(400).json({ error: "INVALID_PASSWORD", message: error.message });
        return;
      }
      console.error("Registration failed:", error);
      res.status(500).json({ error: "REGISTRATION_FAILED", message: "注册失败，请稍后重试。" });
    }
  });

  router.post("/login", async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const user = email ? await repository.findUserByEmail(email) : null;
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      res.status(401).json({ error: "INVALID_CREDENTIALS", message: "邮箱或密码错误。" });
      return;
    }

    await sessionService.signIn(res, user.id);
    res.json({ user: publicUser(user) });
  });

  router.post("/logout", async (req, res) => {
    await sessionService.signOut(req, res);
    res.status(204).end();
  });

  router.get("/me", async (req, res) => {
    const user = await sessionService.getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: "AUTH_REQUIRED", message: "请先登录。" });
      return;
    }
    res.json({ user: publicUser(user) });
  });

  return router;
}
