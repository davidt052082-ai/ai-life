import "dotenv/config";
import cookieParser from "cookie-parser";
import express from "express";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createSessionService } from "./src/auth/session.js";
import { createDatabasePool } from "./src/db/pool.js";
import { STUDY_PLAN_PROJECT_CODE, WEARABLE_PROJECT_CODE } from "./src/db/migrate.js";
import { CollectorError, toErrorResponse } from "./src/product-collector/errors.js";
import { collectProductFromUrl as defaultCollectProductFromUrl } from "./src/product-collector/index.js";
import { createBrowserProductCollector } from "./src/product-collector/browserCollector.js";
import { createUserRepository } from "./src/repositories/userRepository.js";
import { createAdminRepository } from "./src/repositories/adminRepository.js";
import { createWearableRepository } from "./src/repositories/wearableRepository.js";
import { createStudyPlanRepository } from "./src/repositories/studyPlanRepository.js";
import { createStudyPeopleRepository } from "./src/repositories/studyPeopleRepository.js";
import { createAnalyticsRepository } from "./src/repositories/analyticsRepository.js";
import { createAuthRouter } from "./src/routes/authRoutes.js";
import { createProjectRouter } from "./src/routes/projectRoutes.js";
import { createAdminRouter } from "./src/routes/adminRoutes.js";
import { createAnalyticsRouter } from "./src/routes/analyticsRoutes.js";
import { createAdminAnalyticsRouter } from "./src/routes/adminAnalyticsRoutes.js";
import { createWearableRouter } from "./src/routes/wearableRoutes.js";
import { createStudyPlanRouter } from "./src/routes/studyPlanRoutes.js";
import { createStudyPeopleRouter } from "./src/routes/studyPeopleRoutes.js";
import { renderShareImagePng as defaultRenderShareImagePng } from "./src/shareImage.js";
import { createSlidingWindowRateLimiter } from "./src/analytics/rateLimiter.js";
import { startAnalyticsMaintenance } from "./src/analytics/maintenance.js";
import { normalizeServerEvent } from "./src/analytics/normalizeEvent.js";

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
  const adminRepository = options.adminRepository || (pool ? createAdminRepository(pool) : null);
  const adminEmail = options.adminEmail ?? process.env.ADMIN_EMAIL ?? "";
  const wearableRepository = options.wearableRepository || (pool ? createWearableRepository(pool) : null);
  const studyPlanRepository = options.studyPlanRepository || (pool ? createStudyPlanRepository(pool) : null);
  const studyPeopleRepository = options.studyPeopleRepository || (pool ? createStudyPeopleRepository(pool) : null);
  const analyticsRepository = options.analyticsRepository || (pool ? createAnalyticsRepository(pool) : null);
  const sessionService = options.sessionService || (userRepository
    ? createSessionService(userRepository, options.sessionOptions)
    : null);
  const sessionSecret = options.sessionSecret || process.env.SESSION_SECRET || "development-session-secret";
  const analyticsRateLimiter = options.analyticsRateLimiter || createSlidingWindowRateLimiter();
  const analyticsIpSalt = options.analyticsIpSalt ?? process.env.ANALYTICS_IP_SALT ?? "";
  const trustProxy = options.trustProxy ?? process.env.TRUST_PROXY === "true";
  const analytics = analyticsRepository && {
    record(event) {
      return analyticsRepository.recordEvent(normalizeServerEvent({
        id: randomUUID(),
        visitorId: randomUUID(),
        sessionId: randomUUID(),
        ...event
      }));
    }
  };

  app.use(cookieParser(sessionSecret));

  if (userRepository && sessionService && analyticsRepository) {
    app.use("/api/analytics", express.json({ limit: "8kb" }), createAnalyticsRouter({
      repository: analyticsRepository,
      sessionService,
      rateLimiter: analyticsRateLimiter,
      ipSalt: analyticsIpSalt,
      trustProxy
    }));
  } else {
    app.use("/api/analytics", (_req, res) => {
      res.status(503).json({ error: "DATABASE_NOT_CONFIGURED", message: "数据库尚未配置。" });
    });
  }

  app.use(express.json({ limit: "2mb" }));

  if (userRepository && sessionService) {
    app.use("/api/auth", createAuthRouter({
      repository: userRepository,
      sessionService,
      defaultGroupCode: "default",
      adminEmail,
      analytics
    }));
    app.use("/api/projects", createProjectRouter({ repository: userRepository, sessionService }));
    if (analyticsRepository) {
      app.use("/api/admin/analytics", createAdminAnalyticsRouter({ repository: analyticsRepository, sessionService, adminEmail }));
    }
    app.use("/api/admin", createAdminRouter({ repository: adminRepository, sessionService, adminEmail, analytics }));
    app.use("/api/projects/:code/wearable", createWearableRouter({
      repository: wearableRepository,
      projectRepository: userRepository,
      sessionService,
      wearableProjectCode: WEARABLE_PROJECT_CODE,
      analytics
    }));
    app.use("/api/projects/:code/study-plans", createStudyPlanRouter({
      repository: studyPlanRepository,
      peopleRepository: studyPeopleRepository,
      projectRepository: userRepository,
      sessionService,
      studyPlanProjectCode: STUDY_PLAN_PROJECT_CODE,
      analytics
    }));
    app.use("/api/projects/:code/study-plans/people", createStudyPeopleRouter({
      repository: studyPeopleRepository,
      projectRepository: userRepository,
      sessionService,
      studyPlanProjectCode: STUDY_PLAN_PROJECT_CODE
    }));
  } else {
    app.use("/api/auth", (_req, res) => {
      res.status(503).json({ error: "DATABASE_NOT_CONFIGURED", message: "数据库尚未配置。" });
    });
    app.use("/api/projects", (_req, res) => {
      res.status(503).json({ error: "DATABASE_NOT_CONFIGURED", message: "数据库尚未配置。" });
    });
    app.use("/api/admin", (_req, res) => {
      res.status(503).json({ error: "DATABASE_NOT_CONFIGURED", message: "数据库尚未配置。" });
    });
    app.use("/api/projects/:code/study-plans", (_req, res) => {
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
  app.get("/admin", (_req, res) => {
    res.sendFile(path.join(__dirname, "admin.html"));
  });
  app.get("/admin/analytics", (_req, res) => {
    res.sendFile(path.join(__dirname, "analytics.html"));
  });
  app.get("/", (_req, res) => {
    res.sendFile(path.join(__dirname, "project-home.html"));
  });
  app.get("/projects/wearable", (_req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
  });
  app.get("/projects/study-plan", async (req, res, next) => {
    try {
      const user = await sessionService?.getCurrentUser(req);
      if (!user) {
        res.redirect("/login?next=/projects/study-plan");
        return;
      }
      const project = await userRepository?.findProjectAccess({ userId: user.id, projectCode: STUDY_PLAN_PROJECT_CODE });
      if (!project) {
        res.redirect("/");
        return;
      }
      res.sendFile(path.join(__dirname, "study-plan.html"));
    } catch (error) {
      next(error);
    }
  });
  app.get("/study-plan/schedule.js", (_req, res) => {
    res.sendFile(path.join(__dirname, "src", "study-plan", "schedule.js"));
  });
  app.get("/project-cover.js", (_req, res) => {
    res.sendFile(path.join(__dirname, "src", "project-cover.js"));
  });
  app.get("/study-plan-client.js", (_req, res) => {
    res.sendFile(path.join(__dirname, "study-plan-client.js"));
  });
  app.get("/analytics-client.js", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "analytics-client.js"));
  });

  app.locals.syncConfiguredAdmin = async () => {
    if (adminRepository && String(adminEmail).trim()) {
      await adminRepository.syncConfiguredAdmin(adminEmail);
    }
  };
  let stopAnalyticsMaintenance = null;
  app.locals.startAnalyticsMaintenance = () => {
    if (!analyticsRepository) return () => {};
    if (!stopAnalyticsMaintenance) stopAnalyticsMaintenance = startAnalyticsMaintenance(analyticsRepository);
    return stopAnalyticsMaintenance;
  };

  return app;
}

if (process.argv[1] === __filename) {
  const port = Number(process.env.PORT || 5173);
  const app = createApp();
  try {
    await app.locals.syncConfiguredAdmin();
  } catch (error) {
    console.error("Unable to synchronize configured administrator:", error);
  }
  const stopMaintenance = app.locals.startAnalyticsMaintenance();
  const server = app.listen(port, () => {
    console.log(`AI Life wearable collector running at http://localhost:${port}`);
  });
  const stop = () => server.close(() => {
    stopMaintenance();
    process.exit(0);
  });
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
