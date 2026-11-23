import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { applyVerifiedFacebookReadings } from "../domain/facebook-verified-readings.mjs";

export function createFacebookVerifiedReadings({ evidencePath, records = {} }) {
  async function verify(url, index) {
    if (
      !records[url] ||
      !/^\/evidence\/fb-[a-z0-9-]+\.(jpg|png|webp)$/.test(url)
    )
      return index;
    try {
      const bytes = await readFile(path.join(evidencePath, path.basename(url)));
      const hash = createHash("sha256").update(bytes).digest("hex");
      return applyVerifiedFacebookReadings(index, records[url], hash);
    } catch (error) {
      console.warn(
        "Facebook verified evidence:",
        error.code || error.message.split("\n")[0],
      );
      return index;
    }
  }
  return {
    verify,
    async indexes(indexes) {
      return new Map(
        await Promise.all(
          [...indexes].map(async ([url, index]) => [
            url,
            await verify(url, index),
          ]),
        ),
      );
    },
  };
}
