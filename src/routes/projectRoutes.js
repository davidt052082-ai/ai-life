import { Router } from "express";
import { requireProjectAccess, requireUser } from "../auth/middleware.js";

export function createProjectRouter({ repository, sessionService }) {
  const router = Router();
  const userRequired = requireUser(sessionService);

  router.get("/", userRequired, async (req, res) => {
    const projects = await repository.listProjectsForUser(req.user.id);
    res.json({ projects });
  });

  router.get("/:code", userRequired, requireProjectAccess(repository), (req, res) => {
    res.json({ project: req.project });
  });

  return router;
}
