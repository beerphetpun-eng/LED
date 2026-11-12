import { randomUUID } from "node:crypto";
import { validateSettings } from "../domain/catalog.mjs";
import { SourceUnavailableError } from "../domain/errors.mjs";

export function createSyncService({
  repository: db,
  source,
  geocoder,
  files,
  geography,
  clock = () => new Date(),
}) {
  let state = { status: "idle", message: "พร้อมซิงค์", nextRunAt: null },
    running = false,
    controller,
    answer,
    timer,
    ticking = false;
  const persist = async (patch) => {
    state = { ...state, ...patch, updatedAt: clock().toISOString() };
    await db.setState("sync_runtime", state);
  };
  async function cleanup() {
    const settings = await db.getSettings();
    const deleted = await db.expireProperties(settings.retention);
    for (const url of await db.pendingFiles()) {
      if (!(await db.fileReferenced(url))) await files.remove(url);
      await db.completeFile(url);
    }
    if (deleted)
      await db.setState("last_cleanup", { at: clock().toISOString(), deleted });
    return deleted;
  }
  async function collect(job) {
    for (const p of job.properties) {
      if (!p.rawText && p.status !== "failed") continue;
      const fingerprint = JSON.stringify(p);
      if (job.saved.get(p.id) === fingerprint) continue;
      await db.upsertProperty(p, state.runId, state.retention);
      job.saved.set(p.id, fingerprint);
      if (p.error)
        await db.alert(
          `ทรัพย์ ${p.assetSequence} คดี ${p.caseNumber}: ${p.error}`,
        );
    }
    await persist({
      message: job.message,
      pages: state.basePages + job.pages,
      seen: state.baseSeen + job.seen,
      skippedRed: state.baseRed + job.skippedRed,
      skippedExisting: (state.baseExisting || 0) + (job.skippedExisting || 0),
    });
  }
  async function lookup(signal) {
    const records = (await db.allProperties()).filter(
      (p) =>
        p.deed &&
        p.status !== "failed" &&
        (!p.parcels?.length ||
          p.parcels.some(
            (v) =>
              v.status !== "located" ||
              !v.mapEvidenceUrl ||
              v.backgroundReady === false,
          )),
    );
    for (let index = 0; index < records.length; index++) {
      signal.throwIfAborted();
      const p = records[index];
      await persist({
        status: "geocoding",
        message: `ค้นหาพิกัด ${index + 1}/${records.length} · โฉนด ${p.deed}`,
        geoDone: index,
        geoTotal: records.length,
      });
      const parcels = (p.parcels || []).filter(
        (v) =>
          v.status === "located" &&
          v.mapEvidenceUrl &&
          v.backgroundReady !== false,
      );
      for (const deed of p.deed
        .split(", ")
        .filter((d) => !parcels.some((v) => v.deed === d))) {
        try {
          const parcel = await geocoder.locate(p, deed, "catalog", signal);
          parcels.push(parcel);
          if (
            parcel.status !== "located" ||
            parcel.backgroundReady === false ||
            !parcel.mapEvidenceUrl
          )
            await db.alert(
              `โฉนด ${deed} ${p.district}: ${parcel.note || "หลักฐานพิกัดยังไม่ครบ"}`,
            );
        } catch (e) {
          signal.throwIfAborted();
          await db.alert(
            `LandsMaps · โฉนด ${deed}: ${e.message.split("\n")[0]}`,
          );
          if (e instanceof SourceUnavailableError) throw e;
          parcels.push({
            deed,
            status: "lookup_failed",
            latitude: null,
            longitude: null,
            note: e.message.split("\n")[0],
          });
        }
        await db.updateSource(p.id, {
          parcels,
          status:
            parcels.length === p.deed.split(", ").length &&
            parcels.every((v) => v.status === "located")
              ? "located"
              : "needs_review",
        });
      }
    }
    await persist({ geoDone: records.length });
  }
  async function run(scopes, geoOnly) {
    const signal = controller.signal;
    try {
      await cleanup();
      for (let index = 0; index < scopes.length; index++) {
        signal.throwIfAborted();
        const scope = scopes[index];
        await persist({
          status: "preparing",
          message: `เตรียมซิงค์ ${scope.province} · ${scope.district}`,
          scope,
          scopeIndex: index + 1,
        });
        const challenge = await source.prepareScope(scope);
        signal.throwIfAborted();
        const captchaPromise = new Promise((resolve, reject) => {
          const aborted = () => {
            answer = null;
            reject(signal.reason);
          };
          signal.addEventListener("abort", aborted, { once: true });
          answer = (value) => {
            signal.removeEventListener("abort", aborted);
            answer = null;
            resolve(value);
          };
        });
        await persist({
          status: "waiting_captcha",
          message: `กรอกรหัสยืนยันเพื่อซิงค์ ${scope.province} · ${scope.district}`,
          ...challenge,
        });
        const captcha = await captchaPromise;
        await persist({
          status: "extracting",
          captchaUrl: null,
          message: `กำลังอ่านประกาศ ${scope.province} · ${scope.district}`,
          basePages: state.pages || 0,
          baseSeen: state.seen || 0,
          baseRed: state.skippedRed || 0,
          baseExisting: state.skippedExisting || 0,
        });
        const job = {
          id: state.runId,
          values: {
            provinces: scope.provinceCode,
            amphurSelect: scope.districtCode,
          },
          pages: 0,
          seen: 0,
          skippedRed: 0,
          skippedExisting: 0,
          excluded: 0,
          properties: [],
          warnings: [],
          saved: new Map(),
          extractionComplete: false,
        };
        await source.extract(job, captcha, signal, collect);
        await collect(job);
        if (!job.extractionComplete)
          throw Error(job.warnings.join(" · ") || "ต้นทางส่งรายการไม่ครบ");
      }
      await lookup(signal);
      await persist({
        status: "completed",
        message: geoOnly
          ? "จบการค้นพิกัด รายการที่ไม่พบดูได้จากแจ้งเตือน"
          : "ซิงค์ครบขอบเขตที่เลือกแล้ว",
        captchaUrl: null,
        finishedAt: clock().toISOString(),
      });
    } catch (e) {
      const cancelled = signal.aborted;
      if (!cancelled) await db.alert(e.message.split("\n")[0]);
      await persist({
        status: cancelled ? "cancelled" : "partial",
        message: cancelled
          ? "หยุดซิงค์แล้ว ข้อมูลที่บันทึกยังอยู่"
          : e.message.split("\n")[0],
        captchaUrl: null,
        finishedAt: clock().toISOString(),
      });
    } finally {
      answer = null;
      try {
        const s = await db.getSettings();
        if (!geoOnly)
          await persist({
            nextRunAt: new Date(
              clock().getTime() + s.intervalHours * 3600000,
            ).toISOString(),
          });
        await cleanup();
      } catch (e) {
        await db.alert("เก็บกวาดไฟล์ไม่สำเร็จ: " + e.message).catch(() => {});
      } finally {
        running = false;
      }
    }
  }
  const service = {
    task: null,
    get running() {
      return running;
    },
    status: () => ({ ...state, running }),
    async init() {
      await db.saveSettings(await db.getSettings());
      state = await db.getState("sync_runtime", state);
      if (
        !["idle", "completed", "partial", "cancelled", "interrupted"].includes(
          state.status,
        )
      ) {
        await persist({
          status: "interrupted",
          captchaUrl: null,
          message: "โปรแกรมปิดระหว่างซิงค์ จะเริ่มรอบใหม่ตามการตั้งค่า",
        });
        await db.alert("งานซิงค์ถูกขัดจังหวะ ข้อมูลที่บันทึกแล้วไม่หาย");
      }
    },
    async settings(value) {
      if (running) throw Error("หยุดซิงค์ก่อนเปลี่ยนขอบเขต");
      const checked = validateSettings(value, geography);
      await db.saveSettings(checked);
      await persist({ nextRunAt: clock().toISOString() });
      return checked;
    },
    async start(geoOnly = false) {
      if (running) throw Error("มีงานซิงค์กำลังทำงานอยู่");
      running = true;
      controller = new AbortController();
      try {
        const s = validateSettings(await db.getSettings(), geography);
        const scopes = geoOnly
          ? []
          : s.scopes.flatMap((v) => {
              const p = geography.provinces.find(
                (x) => x.code === v.provinceCode,
              );
              return v.districtCodes.map((code) => ({
                provinceCode: p.code,
                province: p.name,
                districtCode: code,
                district: p.districts.find((d) => d.code === code).name,
              }));
            });
        if (!geoOnly && !scopes.length) throw Error("เลือกขอบเขตซิงค์ก่อน");
        await persist({
          runId: randomUUID(),
          status: "preparing",
          message: "เริ่มซิงค์",
          startedAt: clock().toISOString(),
          finishedAt: null,
          scopeCount: scopes.length,
          scopeIndex: 0,
          retention: s.retention,
          pages: 0,
          seen: 0,
          skippedRed: 0,
          geoDone: 0,
          skippedExisting: 0,
          geoTotal: 0,
          captchaUrl: null,
        });
        service.task = run(scopes, geoOnly).catch(async (e) => {
          running = false;
          await db.alert("ระบบซิงค์ผิดพลาด: " + e.message).catch(() => {});
          state = {
            ...state,
            status: "failed",
            message: e.message,
            captchaUrl: null,
          };
        });
        return service.status();
      } catch (e) {
        running = false;
        throw e;
      }
    },
    submitCaptcha(code) {
      if (!answer || state.status !== "waiting_captcha")
        throw Error("ไม่มีงานรอรหัสยืนยัน");
      if (!/^\d{6}$/.test(code)) throw Error("กรอกรหัส 6 หลัก");
      answer(code);
    },
    cancel() {
      controller?.abort();
    },
    async tick() {
      if (ticking || (running && state.status !== "waiting_captcha")) return;
      ticking = true;
      try {
        await cleanup();
        if (running) return;
        const s = await db.getSettings();
        if (
          s.enabled &&
          (!state.nextRunAt || Date.parse(state.nextRunAt) <= clock().getTime())
        )
          await service.start();
      } catch (e) {
        await db.alert(e.message);
      } finally {
        ticking = false;
      }
    },
    schedule() {
      timer = setInterval(() => void service.tick(), 60000);
      timer.unref();
      void service.tick();
    },
    async stop() {
      clearInterval(timer);
      service.cancel();
      await service.task;
    },
    cleanup,
  };
  return service;
}
