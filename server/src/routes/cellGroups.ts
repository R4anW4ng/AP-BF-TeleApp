import { Router } from "express";
import { prisma } from "../db.js";

export function cellGroupsRouter(): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    const cellGroups = await prisma.cellGroup.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      select: { id: true, code: true, name: true },
    });
    res.json({ cellGroups });
  });

  return router;
}
