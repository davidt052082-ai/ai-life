import { Router } from "express";
import { requireUser } from "../auth/middleware.js";

function callbackError(res, error) {
  const code = error?.code || "HUAWEI_OAUTH_FAILED";
  res.redirect(`/projects/health?tab=settings&huawei=${encodeURIComponent(code)}`);
}

export function createHuaweiHealthCallbackRouter({ sessionService, huaweiService }) {
  const router = Router();
  router.get("/callback", requireUser(sessionService), async (req, res) => {
    if (req.query.error) { res.redirect("/projects/health?tab=settings&huawei=denied"); return; }
    try {
      const result = await huaweiService.completeConnection({ code: req.query.code, state: req.query.state });
      res.redirect(result.redirectPath || "/projects/health?tab=settings");
    } catch (error) { callbackError(res, error); }
  });
  return router;
}
