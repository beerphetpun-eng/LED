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
  const propertyDetails = async (property) => ({
    ...property,
    facebook: await facebook.forProperty(property),
  });
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(req.get("Host") || ""))
      return res.status(403).json({ error: "เปิด Land Radar ผ่าน localhost" });
    next();
  });
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
    const capabilities = {
      facebookAlbumCoverage: true,
      facebookPublicExactDates: true,
      facebookAuctionSchedule: true,
      facebookFeedPermalinks: true,
      facebookPublicIndex: true,
      facebookSharedAlbums: true,
      facebookCaseFilter: true,
      deedRefresh: true,
    };
    try {
      await db.health();
      res.json({
        status: "ok",
        source: "LED + LandsMaps",
        version: 2,
        capabilities,
      });
    } catch {
      res.status(503).json({
        status: "unavailable",
        source: "LED + LandsMaps",
        version: 2,
        capabilities,
        error: "เชื่อมต่อฐานข้อมูลไม่สำเร็จ",
      });
    }
  });
  app.get("/api/geography", (req, res) => res.json(geography));
  app.get("/api/sync", async (req, res) =>
    res.json({
      settings: await db.getSettings(),
      runtime: sync.status(),
      alerts: await db.alerts(),
      facebookLibrary: await facebook.status(),
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
      ? res.json(await propertyDetails(p))
      : res.status(404).json({ error: "ไม่พบทรัพย์ อาจหมดอายุและถูกลบแล้ว" });
  });
  app.patch("/api/properties/:propertyId/user", async (req, res) =>
    res.json(await db.updateUser(req.params.propertyId, req.body)),
  );
  app.post("/api/properties/:propertyId/photos/refresh", async (req, res) => {
    const result = await sync.refreshPhotos(req.params.propertyId);
    res.json({ ...result, property: await propertyDetails(result.property) });
  });
  app.post("/api/properties/:propertyId/deeds/refresh", async (req, res) => {
    const result = await sync.refreshDeeds(req.params.propertyId);
    res.json({ ...result, property: await propertyDetails(result.property) });
  });
  app.post("/api/properties/:propertyId/facebook", async (req, res) => {
    const p = await db.getProperty(req.params.propertyId);
    if (!p) throw Error("ไม่พบทรัพย์");
    res.json(await propertyDetails(p));
  });
  app.post("/api/facebook/library/refresh", async (_req, res) =>
    res.json(await facebook.refresh()),
  );
  app.use("/api", (req, res) => res.status(404).json({ error: "ไม่พบ API" }));
  app.use("/evidence", express.static(evidencePath, { dotfiles: "deny" }));
  app.use(express.static(path.join(root, "wwwroot")));
  app.get("/", (req, res) =>
    res.sendFile(path.join(root, "wwwroot", "index.html")),
  );
  app.use((e, req, res, next) => {
    if (res.headersSent) return next(e);
    if (e.type === "entity.parse.failed")
      return res.status(400).json({ error: "ข้อมูล JSON ไม่ถูกต้อง" });
    if (e.type === "entity.too.large")
      return res.status(413).json({ error: "ข้อมูลที่ส่งมีขนาดใหญ่เกินไป" });
    const message = /password|postgres/i.test(e.message)
      ? "เชื่อมต่อฐานข้อมูลไม่สำเร็จ"
      : String(e.message).split("\n")[0];
    void db.alert(message).catch(() => {});
    res.status(400).json({ error: message });
  });
  return app;
}
