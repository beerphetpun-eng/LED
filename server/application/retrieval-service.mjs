import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { validateValues } from "../domain/parsing.mjs";
import { SourceUnavailableError } from "../domain/errors.mjs";
/** Dependency ports: repository, source, geocoder, workspace. No HTTP, SQL or browser imports. */
export function createRetrievalService({
  repository,
  source,
  geocoder,
  workspace,
  pause = (signal) => delay(1000, undefined, { signal }),
}) {
  async function progress(job, status, message) {
    Object.assign(job, { status, message });
    await repository.saveJob(job);
  }
  const retrieval = {
    activeId: null,
    controller: null,
    promise: null,
    async start(request) {
      return workspace.exclusive(async () => {
        validateValues(request.values);
        if (!/^[0-9]{6}$/.test(request.captcha))
          throw Error("กรอกรหัสยืนยัน 6 หลัก");
        if (
          typeof request.name !== "string" ||
          !request.name.trim() ||
          request.name.length > 120
        )
          throw Error("ตั้งชื่อการค้นหา 1–120 ตัวอักษร");
        await source.prepare(request.values);
        const job = {
          id: randomUUID(),
          name: request.name,
          values: request.values,
          status: "queued",
          message: "รอเริ่ม",
          createdAt: new Date().toISOString(),
          finishedAt: null,
          pages: 0,
          seen: 0,
          skippedRed: 0,
          excluded: 0,
          extractionComplete: false,
          properties: [],
          warnings: [],
        };
        await repository.saveJob(job);
        this.launch(job, () =>
          execute(job, request.captcha, this.controller.signal),
        );
        return job.id;
      });
    },
    launch(job, fn) {
      workspace.busy = true;
      this.activeId = job.id;
      this.controller = new AbortController();
      this.promise = (async () => {
        try {
          await fn();
        } catch (e) {
          await progress(
            job,
            e.name === "AbortError" ? "cancelled" : "failed",
            e.name === "AbortError"
              ? "หยุดงานแล้ว ข้อมูลที่บันทึกแล้วเปิดดูได้"
              : String(e.message).split("\n")[0],
          );
          console.error("Retrieval:", String(e.message).slice(0, 400));
        } finally {
          job.finishedAt = new Date().toISOString();
          try {
            await repository.saveJob(job);
          } finally {
            workspace.busy = false;
            this.activeId = null;
          }
        }
      })().catch((e) => {
        workspace.busy = false;
        this.activeId = null;
        console.error("Failed to persist retrieval:", e.message);
      });
    },
    cancel() {
      this.controller?.abort();
    },
    async retry(id) {
      return workspace.exclusive(async () => {
        const job = await repository.getJob(id);
        if (!job) throw Error("ไม่พบผลค้นหา");
        job.finishedAt = null;
        this.launch(job, () => geocode(job, this.controller.signal));
        return id;
      });
    },
  };

  async function execute(job, captcha, signal) {
    await source.extract(job, captcha, signal, (j) => repository.saveJob(j));
    await geocode(job, signal);
  }
  async function geocode(job, signal) {
    for (const p of job.properties.filter(
      (p) => p.deed && p.status !== "located" && p.status !== "failed",
    )) {
      signal.throwIfAborted();
      await progress(
        job,
        "geocoding",
        `ค้นหาพิกัด ${p.deed} · ${p.district} (${job.properties.indexOf(p) + 1}/${job.properties.length})`,
      );
      const existing = p.parcels.filter((v) => v.status === "located");
      p.parcels = existing;
      for (const deed of p.deed
        .split(", ")
        .filter((d) => !existing.some((v) => v.deed === d))) {
        signal.throwIfAborted();
        try {
          p.parcels.push(await geocoder.locate(p, deed, job.id, signal));
        } catch (e) {
          if (e.name === "AbortError") throw e;
          p.parcels.push({
            deed,
            latitude: null,
            longitude: null,
            status: "lookup_failed",
            note: String(e.message).split("\n")[0],
          });
          if (e instanceof SourceUnavailableError) {
            p.status = "needs_review";
            await progress(job, "partial", e.message);
            return;
          }
        }
        await repository.saveJob(job);
        await pause(signal);
      }
      p.status =
        p.parcels.length > 0 &&
        p.parcels.every((v) => v.status === "located") &&
        p.auctionDates.length
          ? "located"
          : "needs_review";
      await repository.saveJob(job);
    }
    const complete =
      job.extractionComplete === true &&
      !job.warnings.length &&
      job.properties.every((p) => p.status === "located");
    await progress(
      job,
      complete ? "completed" : "partial",
      complete
        ? "ดึงครบทุกหน้าและค้นพบพิกัดทุกรายการ"
        : "จบการดึงข้อมูลแล้ว มีรายการที่ต้องตรวจสอบหรือยังไม่พบพิกัด",
    );
  }

  return retrieval;
}
