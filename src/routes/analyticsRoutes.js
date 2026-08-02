import { randomUUID } from "node:crypto";
import { Router } from "express";
import { normalizeClientEvent, requestAnalyticsContext } from "../analytics/normalizeEvent.js";

function sendError(res, error) {
  if (error.code === "INVALID_ANALYTICS_EVENT") {
    res.status(400).json({ error: error.code, message: error.message });
    return;
  }
  console.error("Analytics event ingestion failed:", error);
  res.status(500).json({ error: "ANALYTICS_EVENT_FAILED", message: "统计事件暂时无法记录。" });
}

export function createAnalyticsRouter({ repository, sessionService, rateLimiter, excludedTraffic, ipSalt = "", trustProxy = false }) {
  const router = Router();

  router.post("/events", async (req, res) => {
    try {
      const event = normalizeClientEvent(req.body);
      if (excludedTraffic?.has(req.ip)) {
        res.status(204).end();
        return;
      }
      const requestContext = requestAnalyticsContext(req, { ipSalt, trustProxy });
      const rateLimitKey = `${requestContext.ipHash || "no-ip"}:${event.visitorId}`;
      if (!rateLimiter.allow(rateLimitKey)) {
        res.status(204).end();
        return;
      }
      const user = await sessionService.getCurrentUser(req);
      await repository.recordEvent({
        ...event,
        id: randomUUID(),
        userId: user?.id || null,
        ...requestContext
      });
      res.status(204).end();
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}
