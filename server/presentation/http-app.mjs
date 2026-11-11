import express from "express";
import path from "node:path";
import { validateValues } from "../domain/parsing.mjs";
export function createHttpApp({
  repository: db,
  browser,
  retrieval,
  root,
  evidencePath,
}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (req.method !== "GET") {
      if (req.get("X-Land-Radar") !== "1")
        return res.status(403).json({ error: "คำขอไม่ถูกต้อง" });
      if (
        req.get("Origin") &&
        ![
          "http://127.0.0.1:5080",
          "http://localhost:5080",
          "http://127.0.0.1:5173",
        ].includes(req.get("Origin"))
      )
        return res.status(403).json({ error: "ไม่อนุญาตคำขอข้ามเว็บไซต์" });
    }
    next();
  });
  const uuid = (s) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
  app.param("id", (req, res, next, id) =>
    uuid(id) ? next() : res.status(400).json({ error: "ID ไม่ถูกต้อง" }),
  );
  app.get("/api/health", async (req, res) => {
    await db.health();
    res.json({
      status: "ok",
      database: "PostgreSQL",
      backend: "Node.js",
      source: "LED + LandsMaps",
    });
  });
  app.post("/api/schema", async (req, res) =>
    res.json(
      await browser.exclusive(() => browser.schema(req.body.refresh === true)),
    ),
  );
  app.post("/api/schema/select", async (req, res) =>
    res.json(
      await browser.exclusive(() =>
        browser.select(req.body.key, req.body.value),
      ),
    ),
  );
  app.get("/api/captcha", (req, res) =>
    res.sendFile(path.join(evidencePath, "captcha.png")),
  );
  app.get("/api/bookmarks", async (req, res) =>
    res.json(await db.listBookmarks()),
  );
  app.put("/api/bookmarks/:id", async (req, res) => {
    const { name, values } = req.body;
    validateValues(values);
    if (typeof name !== "string" || !name.trim() || name.length > 120)
      throw Error("ตั้งชื่อ bookmark 1–120 ตัวอักษร");
    const b = {
      id: req.params.id,
      name,
      values,
      savedAt: new Date().toISOString(),
    };
    await db.saveBookmark(b);
    res.json(b);
  });
  app.delete("/api/bookmarks/:id", async (req, res) => {
    await db.deleteBookmark(req.params.id);
    res.status(204).end();
  });
  app.get("/api/jobs", async (req, res) => res.json(await db.listJobs()));
  app.get("/api/jobs/:id", async (req, res) => {
    const j = await db.getJob(req.params.id);
    j ? res.json(j) : res.status(404).json({ error: "ไม่พบผลค้นหา" });
  });
  app.get("/api/active", (req, res) => res.json({ id: retrieval.activeId }));
  app.post("/api/jobs", async (req, res) =>
    res.json({ id: await retrieval.start(req.body) }),
  );
  app.post("/api/jobs/:id/retry", async (req, res) =>
    res.json({ id: await retrieval.retry(req.params.id) }),
  );
  app.post("/api/cancel", (req, res) => {
    retrieval.cancel();
    res.json({ ok: true });
  });
  app.use("/api", (req, res) => res.status(404).json({ error: "ไม่พบ API" }));
  app.use("/evidence", express.static(evidencePath, { dotfiles: "deny" }));
  app.use(express.static(path.join(root, "wwwroot")));
  app.get("/", (req, res) =>
    res.sendFile(path.join(root, "wwwroot", "index.html")),
  );
  app.use((err, req, res, next) => {
    console.error(String(err.message).slice(0, 600));
    if (!res.headersSent)
      res.status(400).json({
        error: err.message?.includes("password")
          ? "เชื่อมต่อฐานข้อมูลไม่สำเร็จ"
          : String(err.message).split("\n")[0],
      });
  });

  return app;
}
