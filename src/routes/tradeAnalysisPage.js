import { TRADE_ANALYSIS_PROJECT_CODE } from "../db/migrate.js";

export function createTradeAnalysisPageHandler({ repository, sessionService, targetUrl }) {
  return async (req, res, next) => {
    try {
      const user = await sessionService?.getCurrentUser(req);
      if (!user) {
        res.redirect("/login?next=/projects/trade-analysis");
        return;
      }

      const project = await repository?.findProjectAccess({
        userId: user.id,
        projectCode: TRADE_ANALYSIS_PROJECT_CODE
      });
      if (!project) {
        res.redirect("/");
        return;
      }

      if (!targetUrl) {
        res.status(503).send("交易分析服务尚未配置。");
        return;
      }

      res.redirect(302, targetUrl);
    } catch (error) {
      next(error);
    }
  };
}
