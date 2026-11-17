import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value) => createHash("sha256").update(value).digest();
const localHost = /^(?:127\.0\.0\.1|localhost)(?::\d+)?$/i;

export function createRemoteAccess(settings) {
  if (!settings) return null;
  const { hostname, password, publicReadOnly = false } = settings;
  if (
    typeof hostname !== "string" ||
    !/^(?:[a-z0-9]+(?:-[a-z0-9]+)*\.)+[a-z0-9]+$/i.test(hostname) ||
    typeof publicReadOnly !== "boolean" ||
    (!publicReadOnly &&
      (typeof password !== "string" || !/^[!-~]{24,}$/.test(password)))
  )
    throw Error("Invalid configuration in server/data/remote-access.json");

  const host = hostname.toLowerCase();
  if (publicReadOnly) return { host, publicReadOnly };
  const credentials = digest(
    Buffer.from("landradar:" + password, "ascii").toString("base64"),
  );
  return {
    host,
    origin: "https://" + host,
    authenticates(authorization) {
      const encoded = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(
        authorization || "",
      );
      return Boolean(
        encoded && timingSafeEqual(digest(encoded[1]), credentials),
      );
    },
  };
}

export function restrictHost(remote) {
  return (req, res, next) => {
    const host = req.get("Host")?.toLowerCase();
    if (remote && host === remote.host) {
      res.set("Cache-Control", "private, no-store");
      res.set("Referrer-Policy", "same-origin");
      if (remote.publicReadOnly) {
        if (!["GET", "HEAD"].includes(req.method))
          return res.status(403).json({
            error: "ลิงก์นี้เปิดสำหรับดูข้อมูลเท่านั้น",
          });
        res.locals.publicReadOnly = true;
        return next();
      }
      if (!remote.authenticates(req.get("Authorization")))
        return res
          .set("WWW-Authenticate", 'Basic realm="Land Radar"')
          .status(401)
          .json({ error: "กรุณาเข้าสู่ระบบ Land Radar" });
      res.locals.remoteAccess = true;
      return next();
    }
    if (
      localHost.test(host || "") &&
      !req.get("CF-Ray") &&
      !req.get("CF-Connecting-IP")
    )
      return next();
    res
      .status(403)
      .json({ error: "โดเมนนี้ไม่ได้รับอนุญาตให้เปิด Land Radar" });
  };
}
