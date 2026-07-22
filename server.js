import "dotenv/config";
import cookieParser from "cookie-parser";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSessionService } from "./src/auth/session.js";
import { createDatabasePool } from "./src/db/pool.js";
import { WEARABLE_PROJECT_CODE } from "./src/db/migrate.js";
import { CollectorError, toErrorResponse } from "./src/product-collector/errors.js";
import { collectProductFromUrl as defaultCollectProductFromUrl } from "./src/product-collector/index.js";
import { createBrowserProductCollector } from "./src/product-collector/browserCollector.js";
import { createUserRepository } from "./src/repositories/userRepository.js";
import { createWearableRepository } from "./src/repositories/wearableRepository.js";
import { createAuthRouter } from "./src/routes/authRoutes.js";
import { createProjectRouter } from "./src/routes/projectRoutes.js";
import { createWearableRouter } from "./src/routes/wearableRoutes.js";
import { renderShareImagePng as defaultRenderShareImagePng } from "./src/shareImage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp(options = {}) {
  const app = express();
  const collectProductFromUrl = options.collectProductFromUrl || defaultCollectProductFromUrl;
  const browserCollector = options.browserCollector || createBrowserProductCollector();
  const renderShareImagePng = options.renderShareImagePng || defaultRenderShareImagePng;
  const connectionString = options.disableDatabase ? null : (options.databaseUrl || process.env.DATABASE_URL);
  const pool = options.pool || (connectionString ? createDatabasePool(connectionString) : null);
  const userRepository = options.userRepository || (pool ? createUserRepository(pool) : null);
  const wearableRepository = options.wearableRepository || (pool ? createWearableRepository(pool) : null);
  const sessionService = options.sessionService || (userRepository
    ? createSessionService(userRepository, options.sessionOptions)
    : null);
  const sessionSecret = options.sessionSecret || process.env.SESSION_SECRET || "development-session-secret";

  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser(sessionSecret));

  if (userRepository && sessionService) {
    app.use("/api/auth", createAuthRouter({
      repository: userRepository,
      sessionService,
      defaultProjectCode: WEARABLE_PROJECT_CODE
    }));
    app.use("/api/projects", createProjectRouter({ repository: userRepository, sessionService }));
    app.use("/api/projects/:code/wearable", createWearableRouter({
      repository: wearableRepository,
      projectRepository: userRepository,
      sessionService,
      wearableProjectCode: WEARABLE_PROJECT_CODE
    }));
  } else {
    app.use("/api/auth", (_req, res) => {
      res.status(503).json({ error: "DATABASE_NOT_CONFIGURED", message: "数据库尚未配置。" });
    });
    app.use("/api/projects", (_req, res) => {
      res.status(503).json({ error: "DATABASE_NOT_CONFIGURED", message: "数据库尚未配置。" });
    });
  }

  app.post("/api/collect-product", async (req, res) => {
    const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
    if (!url) {
      const error = new CollectorError("INVALID_URL", "请提供产品网址。", { status: 400 });
      const response = toErrorResponse(error);
      res.status(response.status).json(response.body);
      return;
    }

    try {
      const result = await collectProductFromUrl(url);
      res.json(result);
    } catch (error) {
      const response = toErrorResponse(error);
      res.status(response.status).json(response.body);
    }
  });

  app.post("/api/browser/open-product", async (req, res) => {
    const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
    if (!url) {
      const error = new CollectorError("INVALID_URL", "请提供产品网址。", { status: 400 });
      const response = toErrorResponse(error);
      res.status(response.status).json(response.body);
      return;
    }

    try {
      const result = await browserCollector.openProductPage(url);
      res.json(result);
    } catch (error) {
      const response = toErrorResponse(error);
      res.status(response.status).json(response.body);
    }
  });

  app.post("/api/browser/collect-current", async (_req, res) => {
    try {
      const result = await browserCollector.collectCurrentProduct();
      res.json(result);
    } catch (error) {
      const response = toErrorResponse(error);
      res.status(response.status).json(response.body);
    }
  });

  app.post("/api/share-image", async (req, res) => {
    const html = typeof req.body?.html === "string" ? req.body.html : "";
    try {
      const png = await renderShareImagePng(html);
      res
        .status(200)
        .set({
          "Content-Type": "image/png",
          "Content-Disposition": 'attachment; filename="system-monitor-evaluation.png"',
          "Cache-Control": "no-store"
        })
        .send(png);
    } catch (error) {
      const response = toErrorResponse(error);
      res.status(response.status).json(response.body);
    }
  });

  app.get("/favicon.ico", (_req, res) => {
    res.status(204).end();
  });

  app.use("/assets", express.static(path.join(__dirname, "assets")));
  app.use("/output", express.static(path.join(__dirname, "output")));
  app.get("/login", (_req, res) => {
    res.sendFile(path.join(__dirname, "login.html"));
  });
  app.get("/register", (_req, res) => {
    res.sendFile(path.join(__dirname, "register.html"));
  });
  app.get("/", (_req, res) => {
    res.sendFile(path.join(__dirname, "project-home.html"));
  });
  app.get("/projects/wearable", (_req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
  });

  return app;
}

if (process.argv[1] === __filename) {
  const port = Number(process.env.PORT || 5173);
  createApp().listen(port, () => {
    console.log(`AI Life wearable collector running at http://localhost:${port}`);
  });
}
