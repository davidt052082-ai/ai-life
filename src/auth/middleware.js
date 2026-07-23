export function requireUser(sessionService) {
  return async (req, res, next) => {
    const user = await sessionService.getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: "AUTH_REQUIRED", message: "请先登录。" });
      return;
    }

    req.user = user;
    next();
  };
}

export function requireProjectAccess(repository) {
  return async (req, res, next) => {
    const project = await repository.findProjectAccess({
      userId: req.user.id,
      projectCode: req.params.code
    });
    if (!project) {
      res.status(403).json({ error: "PROJECT_ACCESS_DENIED", message: "你没有访问此项目的权限。" });
      return;
    }

    req.project = project;
    next();
  };
}

export function requireAdmin({ adminEmail }) {
  return (req, res, next) => {
    if (!String(adminEmail || "").trim()) {
      res.status(503).json({ error: "ADMIN_NOT_CONFIGURED", message: "尚未配置管理员账号。" });
      return;
    }
    if (!req.user?.isAdmin) {
      res.status(403).json({ error: "ADMIN_REQUIRED", message: "需要管理员权限。" });
      return;
    }
    next();
  };
}
