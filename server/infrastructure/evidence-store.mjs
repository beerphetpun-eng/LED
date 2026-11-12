import { unlink } from "node:fs/promises";
import path from "node:path";
export function createEvidenceStore(directory) {
  return {
    async remove(url) {
      if (!/^\/evidence\/[a-zA-Z0-9_-]+\.(png|jpg|webp)$/.test(url))
        throw Error("ชื่อไฟล์หลักฐานไม่ถูกต้อง");
      const target = path.resolve(directory, path.basename(url));
      if (path.dirname(target) !== path.resolve(directory))
        throw Error("ไฟล์อยู่นอกโฟลเดอร์หลักฐาน");
      try {
        await unlink(target);
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    },
  };
}
