import express from "express";
import path from "node:path";
export function createCatalogHttp({
  repository: db,
  sync,
  geography,
  facebook,
  root,
  evidencePath,
}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "150kb" }));
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (
      req.method !== "GET" &&
      (req.get("X-Land-Radar") !== "1" ||
        (req.get("Origin") &&
          ![
            "http://127.0.0.1:5080",
            "http://localhost:5080",
            "http://127.0.0.1:5173",
          ].includes(req.get("Origin"))))
    )
      return res.status(403).json({ error: "ไม่อนุญาตคำขอข้ามเว็บไซต์" });
    next();
  });
  app.get("/api/health", async (req, res) => {
    await db.health();
    res.json({ status: "ok", source: "LED + LandsMaps", version: 2 });
  });
  app.get("/api/geography", (req, res) => res.json(geography));
  app.get("/api/sync", async (req, res) =>
    res.json({
      settings: await db.getSettings(),
      runtime: sync.status(),
      alerts: await db.alerts(),
      lastCleanup: await db.getState("last_cleanup"),
    }),
  );
  app.put("/api/sync/settings", async (req, res) =>
    res.json(await sync.settings(req.body)),
  );
  app.post("/api/sync/start", async (req, res) => res.json(await sync.start()));
  app.post("/api/sync/geocode", async (req, res) =>
    res.json(await sync.start(true)),
  );
  app.post("/api/sync/cancel", (req, res) => {
    sync.cancel();
    res.json({ ok: true });
  });
  app.post("/api/alerts/:alertId/resolve", async (req, res) => {
    if (!/^\d+$/.test(req.params.alertId)) throw Error("ID ไม่ถูกต้อง");
    await db.resolveAlert(req.params.alertId);
    res.json({ ok: true });
  });
  app.get("/api/properties", async (req, res) =>
    res.json(await db.queryProperties(req.query)),
  );
  app.param("propertyId", (req, res, next, id) =>
    /^[a-f0-9]{32}$/.test(id)
      ? next()
      : res.status(400).json({ error: "รหัสทรัพย์ไม่ถูกต้อง" }),
  );
  app.get("/api/properties/:propertyId", async (req, res) => {
    const p = await db.getProperty(req.params.propertyId);
    p
      ? res.json(p)
      : res.status(404).json({ error: "ไม่พบทรัพย์ อาจหมดอายุและถูกลบแล้ว" });
  });
  app.patch("/api/properties/:propertyId/user", async (req, res) =>
    res.json(await db.updateUser(req.params.propertyId, req.body)),
  );
  app.post("/api/properties/:propertyId/facebook", async (req, res) => {
    const p = await db.getProperty(req.params.propertyId);
    if (!p) throw Error("ไม่พบทรัพย์");
    const days = Number(req.body.nearbyDays ?? 7);
    if (![0, 3, 7, 14].includes(days))
      throw Error("เลือกช่วงวัน 0, 3, 7 หรือ 14 วัน");
    const result = await facebook.search(p, days);
    await db.updateSource(p.id, { facebook: result });
    for (const warning of result.warnings)
      await db.alert("Facebook: " + warning);
    if (!result.posts.length)
      await db.alert(
        `Facebook: ไม่พบโพสต์ที่ตรงวันสำหรับคดี ${p.caseNumber} ในช่วงโพสต์ที่ตรวจอ่านได้`,
      );
    res.json(await db.getProperty(p.id));
  });
  app.use("/api", (req, res) => res.status(404).json({ error: "ไม่พบ API" }));
  app.use("/evidence", express.static(evidencePath, { dotfiles: "deny" }));
  app.use(express.static(path.join(root, "wwwroot")));
  app.get("/", (req, res) =>
    res.sendFile(path.join(root, "wwwroot", "index.html")),
  );
  app.use((e, req, res, next) => {
    const message = /password|postgres/i.test(e.message)
      ? "เชื่อมต่อฐานข้อมูลไม่สำเร็จ"
      : String(e.message).split("\n")[0];
    void db.alert(message).catch(() => {});
    if (!res.headersSent) res.status(400).json({ error: message });
  });
  return app;
}
