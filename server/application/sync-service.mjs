import { randomUUID } from "node:crypto";
import {
  bangkokDay,
  validateSettings,
  missingParcelDeeds,
} from "../domain/catalog.mjs";
import {
  SourceUnavailableError,
  SourceRateLimitError,
} from "../domain/errors.mjs";
import { clean, district } from "../domain/parsing.mjs";

const dayMs = 24 * 60 * 60 * 1000;
const verified = (p) =>
  p?.status === "located" &&
  Number.isFinite(p.latitude) &&
  Number.isFinite(p.longitude);

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
    timer,
    ticking = false,
    savingSettings = false,
    photoRefresh = null;
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
      const key = p.id + "::" + (p.componentKey || "primary");
      if (job.saved.get(key) === fingerprint) continue;
      const stored = await db.upsertProperty(p, state.runId, state.retention);
      job.saved.set(key, fingerprint);
      if (stored === null) continue;
      const prefix = `ทรัพย์ ${p.assetSequence} คดี ${p.caseNumber}: `;
      if (p.error || job.detailAttempts.has(key))
        await db.recordCheck({
          key: `led:${key}`,
          message: p.error ? prefix + p.error : null,
          retryable: p.status === "failed" || p.evidenceReady === false,
          attempts: job.detailAttempts.get(key) || 0,
          legacyPrefix: prefix,
          recoveryMessage:
            (job.detailAttempts.get(key) || 0) > 1
              ? prefix + "เปิดประกาศหรือโหลดภาพไม่สำเร็จในการเปิดครั้งแรก"
              : null,
        });
    }
    await persist({
      message: job.message,
      pages: state.basePages + job.pages,
      seen: state.baseSeen + job.seen,
      skippedRed: state.baseRed + job.skippedRed,
      skippedExisting: (state.baseExisting || 0) + (job.skippedExisting || 0),
    });
  }
  async function lookup(signal, automatic) {
    const all = await db.allProperties();
    const day = bangkokDay(clock());
    const lastLookup = (p, deed) =>
      p.parcels?.find((v) => v.deed === deed)?.lookupDay || "";
    const cache = new Map();
    const cacheKey = (p, deed) =>
      JSON.stringify([p.province, p.district, p.subdistrict, deed]);
    for (const p of all)
      for (const parcel of p.parcels || []) {
        if (
          parcel.status === "located" &&
          parcel.mapEvidenceUrl &&
          parcel.backgroundReady !== false
        ) {
          const c =
            p.assetComponents?.find((c) =>
              c.deed?.split(", ").includes(parcel.deed),
            ) || p;
          cache.set(cacheKey(c, parcel.deed), parcel);
        }
      }
    const records = all
      .filter((p) => p.deed && p.status !== "failed")
      .map((p) => ({
        p,
        deeds: missingParcelDeeds(p)
          .filter((deed) => !automatic || lastLookup(p, deed) !== day)
          .sort((a, b) => lastLookup(p, a).localeCompare(lastLookup(p, b))),
      }))
      .filter(({ deeds }) => deeds.length)
      .sort((a, b) =>
        lastLookup(a.p, a.deeds[0]).localeCompare(lastLookup(b.p, b.deeds[0])),
      );
    for (let index = 0; index < records.length; index++) {
      signal.throwIfAborted();
      const { p, deeds } = records[index];
      await persist({
        status: "geocoding",
        message: `ค้นหาพิกัด ${index + 1}/${records.length} · โฉนด ${p.deed}`,
        geoDone: index,
        geoTotal: records.length,
      });
      let parcels = p.parcels || [];
      for (const deed of deeds) {
        signal.throwIfAborted();
        const previous = parcels.find((v) => v.deed === deed);
        let parcel;
        let attempts = 0;
        try {
          const component = p.assetComponents?.find((c) =>
            c.deed?.split(", ").includes(deed),
          );
          const record = component ? { ...component, id: p.id } : p;
          const key = cacheKey(record, deed);
          parcel = cache.get(key);
          if (!parcel) {
            attempts++;
            parcel = await geocoder.locate(record, deed, state.runId, signal);
          }
          if (
            parcel.status === "located" &&
            parcel.mapEvidenceUrl &&
            parcel.backgroundReady !== false
          )
            cache.set(key, parcel);
        } catch (e) {
          if (e instanceof SourceUnavailableError) throw e;
          signal.throwIfAborted();
          parcel = {
            deed,
            status: "lookup_failed",
            latitude: null,
            longitude: null,
            note: e.message.split("\n")[0],
          };
        }
        signal.throwIfAborted();
        const prefix = `โฉนด ${deed} ${p.district}: `;
        const ready =
          parcel.status === "located" &&
          parcel.mapEvidenceUrl &&
          parcel.backgroundReady !== false;
        await db.recordCheck({
          key: `lands:${p.id}:${deed}`,
          message: ready
            ? null
            : prefix + (parcel.note || "หลักฐานพิกัดยังไม่ครบ"),
          retryable: !ready,
          attempts,
          legacyPrefix: prefix,
        });
        const saved =
          verified(previous) && !verified(parcel)
            ? {
                ...previous,
                lookupWarning: parcel.note || "ค้นพิกัดซ้ำไม่สำเร็จ",
              }
            : parcel;
        parcels = [
          ...parcels.filter((v) => v.deed !== deed),
          { ...saved, lookupDay: day },
        ];
        await db.updateSource(p.id, {
          parcels,
          status: missingParcelDeeds({ ...p, parcels }).length
            ? "needs_review"
            : "located",
        });
      }
    }
    await persist({ geoDone: records.length });
  }
  async function run(scopes, geoOnly, automatic) {
    const signal = controller.signal;
    let lookedUp = false;
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
        await source.prepareScope(scope);
        signal.throwIfAborted();
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
          detailAttempts: new Map(),
          extractionComplete: false,
        };
        await source.extract(job, signal, collect);
        await collect(job);
        if (!job.extractionComplete)
          throw Error(job.warnings.join(" · ") || "ต้นทางส่งรายการไม่ครบ");
      }
      if (
        state.geoRetryAt &&
        Date.parse(state.geoRetryAt) > clock().getTime()
      ) {
        await persist({
          status: "waiting_limit",
          message: "เก็บประกาศแล้ว · รอโควตา LandsMaps เพื่อค้นพิกัดที่เหลือ",
          finishedAt: clock().toISOString(),
        });
        return;
      }
      lookedUp = true;
      await lookup(signal, automatic);
      await persist({
        status: "completed",
        geoRetryAt: null,
        nextGeoRunAt: new Date(clock().getTime() + dayMs).toISOString(),
        message: geoOnly
          ? "จบการค้นพิกัด รายการที่ไม่พบดูได้จากแจ้งเตือน"
          : "ซิงค์ครบขอบเขตที่เลือกแล้ว",
        captchaUrl: null,
        finishedAt: clock().toISOString(),
      });
    } catch (e) {
      const cancelled = signal.aborted;
      const limited = e instanceof SourceRateLimitError;
      const cancelledLookup = cancelled && lookedUp && !limited;
      if (!cancelled && !limited) await db.alert(e.message.split("\n")[0]);
      await persist({
        status: cancelled ? "cancelled" : limited ? "waiting_limit" : "partial",
        ...(limited
          ? {
              lastQuotaAt: clock().toISOString(),
              quotaMessage: e.message.split("\n")[0],
            }
          : {}),
        ...(limited || (!cancelled && lookedUp && state.geoRetryAt)
          ? {
              geoRetryAt: new Date(
                clock().getTime() + (e.retryAfterMs || 302 * 60000),
              ).toISOString(),
            }
          : {}),
        ...(cancelledLookup ? { geoRetryAt: null } : {}),
        ...(!limited && lookedUp
          ? { nextGeoRunAt: new Date(clock().getTime() + dayMs).toISOString() }
          : {}),
        message: cancelled
          ? "หยุดซิงค์แล้ว ข้อมูลที่บันทึกยังอยู่"
          : e.message.split("\n")[0],
        captchaUrl: null,
        finishedAt: clock().toISOString(),
      });
    } finally {
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
    async refreshPhotos(id) {
      if (running || savingSettings || photoRefresh)
        throw Error(
          "มีงานซิงค์หรือรีเฟรชรูปอยู่ กรุณาลองอีกครั้งเมื่องานเสร็จ",
        );
      const signal = new AbortController();
      photoRefresh = {
        cancel: () => signal.abort(),
        task: (async () => {
          const property = await db.getProperty(id);
          if (!property) throw Error("ไม่พบทรัพย์นี้ในคลัง");
          const province = geography.provinces.find(
            (p) => clean(p.name) === clean(property.province),
          );
          const area = province?.districts.find(
            (d) => district(d.name) === district(property.district),
          );
          if (!area) throw Error("ไม่พบอำเภอของทรัพย์ในรายการค้นหาต้นทาง");
          const scope = {
            provinceCode: province.code,
            districtCode: area.code,
          };
          const components = property.assetComponents?.length
            ? property.assetComponents
            : [property];
          const incomplete = components.filter(
            (c) => c.evidenceReady !== true || !c.evidenceImages?.photos,
          );
          const targetKeys = new Set(
            (incomplete.length ? incomplete : components).map(
              (c) => c.componentKey || "primary",
            ),
          );
          const job = {
            id: randomUUID(),
            targetId: id,
            targetKeys,
            values: {
              provinces: scope.provinceCode,
              amphurSelect: scope.districtCode,
            },
            pages: 0,
            seen: 0,
            skippedRed: 0,
            excluded: 0,
            properties: [],
            warnings: [],
            detailAttempts: new Map(),
          };
          await source.prepareScope(scope);
          await source.extract(job, signal.signal, async () => {});
          signal.signal.throwIfAborted();
          const captures = job.properties.filter(
            (p) => p.screenshotUrl && p.status !== "failed",
          );
          if (!captures.length)
            throw Error(
              "ดึงรูปใหม่ไม่ได้ อาจไม่พบประกาศในรายการขายปัจจุบันหรือเว็บต้นทางไม่ตอบสนอง",
            );
          const changed = new Map(captures.map((p) => [p.componentKey, p]));
          const updated = components.map((c) => {
            const capture = changed.get(c.componentKey || "primary");
            if (!capture) return c;
            const {
              screenshotUrl,
              evidenceImages,
              evidenceReady,
              evidenceVersion,
            } = capture;
            return {
              ...c,
              screenshotUrl,
              evidenceImages,
              evidenceReady,
              evidenceVersion,
            };
          });
          const { screenshotUrl, evidenceImages, evidenceVersion } = updated[0];
          const ready = updated.filter((c) => c.evidenceReady === true).length;
          // Retain warnings unrelated to the photo capture.
          const otherWarnings = (property.error || "")
            .split(" · ")
            .filter(
              (part) =>
                part &&
                !/^(ภาพประกาศยังโหลดไม่ครบ|รูปถ่ายทรัพย์จากต้นทางยังตรวจได้ไม่ครบ)/.test(
                  part,
                ),
            );
          await db.updateSource(id, {
            screenshotUrl,
            evidenceImages,
            evidenceVersion,
            evidenceReady: ready === updated.length,
            error: otherWarnings.join(" · ") || null,
            ...(property.assetComponents?.length
              ? { assetComponents: updated }
              : {}),
          });
          for (const capture of captures) {
            const prefix = `ทรัพย์ ${capture.assetSequence} คดี ${capture.caseNumber}: `;
            await db.recordCheck({
              key: `led:${id}::${capture.componentKey}`,
              message: capture.evidenceReady
                ? null
                : prefix + (capture.error || "รูปประกาศยังโหลดไม่ครบ"),
              retryable: !capture.evidenceReady,
              attempts:
                job.detailAttempts.get(`${id}::${capture.componentKey}`) || 0,
              legacyPrefix: prefix,
            });
          }
          return {
            property: await db.getProperty(id),
            checked: captures.length,
            requested: targetKeys.size,
            complete:
              ready === updated.length && captures.length === targetKeys.size,
          };
        })(),
      };
      try {
        return await photoRefresh.task;
      } finally {
        photoRefresh = null;
      }
    },
    async init() {
      await db.saveSettings(await db.getSettings());
      state = await db.getState("sync_runtime", state);
      if (
        ![
          "idle",
          "completed",
          "partial",
          "cancelled",
          "interrupted",
          "waiting_limit",
        ].includes(state.status)
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
      if (running || savingSettings || photoRefresh)
        throw Error("รองานซิงค์หรือรีเฟรชรูปก่อนเปลี่ยนขอบเขต");
      const checked = validateSettings(value, geography);
      savingSettings = true;
      try {
        await db.saveSettings(checked);
        await persist({
          nextRunAt: checked.scopes.length ? clock().toISOString() : null,
        });
      } finally {
        savingSettings = false;
      }
      if (checked.scopes.length) await service.start(false, true);
      return checked;
    },
    async start(geoOnly = false, automatic = false) {
      if (running || savingSettings || photoRefresh)
        throw Error("มีงานซิงค์หรือรีเฟรชรูปกำลังทำงานอยู่");
      if (
        geoOnly &&
        state.geoRetryAt &&
        Date.parse(state.geoRetryAt) > clock().getTime()
      )
        throw Error(
          "LandsMaps ยังอยู่ในช่วงรอโควตา ระบบจะค้นพิกัดต่ออัตโนมัติตามเวลาที่แสดง",
        );
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
        service.task = run(scopes, geoOnly, automatic).catch(async (e) => {
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
    cancel() {
      controller?.abort();
    },
    async tick() {
      if (ticking || running || savingSettings || photoRefresh) return;
      ticking = true;
      try {
        await cleanup();
        const s = await db.getSettings();
        if (running || savingSettings || photoRefresh || !s.enabled) return;
        const now = clock().getTime();
        const due = (at) => !at || Date.parse(at) <= now;
        if (due(state.nextRunAt)) await service.start(false, true);
        else if (due(state.geoRetryAt || state.nextGeoRunAt))
          await service.start(true, true);
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
      photoRefresh?.cancel();
      await photoRefresh?.task.catch(() => {});
    },
    cleanup,
  };
  return service;
}
