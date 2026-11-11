import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import {
  ArrowDownToLine,
  ArrowRight,
  Bookmark,
  Check,
  ChevronDown,
  Compass,
  Crosshair,
  Database,
  ExternalLink,
  History,
  Layers,
  LoaderCircle,
  MapPin,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Square,
  Trash2,
  X,
  Image as ImageIcon,
  AlertCircle,
} from "lucide-react";
import "leaflet/dist/leaflet.css";
import "./style.css";

type Values = Record<string, string>;
type Field = {
  key: string;
  label: string;
  kind: string;
  value: string;
  options: { value: string; label: string }[];
};
type Schema = { fields: Field[]; captchaUrl: string; refreshedAt: string };
type Saved = { id: string; name: string; values: Values; savedAt: string };
type Parcel = {
  deed: string;
  latitude: number | null;
  longitude: number | null;
  status: string;
  evidenceUrl?: string;
  note?: string;
};
type Property = {
  id: string;
  title: string;
  propertyType: string;
  province: string;
  district: string;
  subdistrict: string;
  deed: string;
  landDocument?: string;
  areaSqWa: number | null;
  areaText: string;
  price: number | null;
  auctionDates: string[];
  screenshotUrl: string;
  sourceUrl: string;
  status: string;
  error?: string;
  parcels: Parcel[];
  retrievedAt: string;
};
type Job = {
  id: string;
  name: string;
  status: string;
  message: string;
  createdAt: string;
  finishedAt?: string;
  values: Values;
  pages: number;
  seen: number;
  skippedRed: number;
  excluded: number;
  properties: Property[];
  warnings: string[];
};
type HistoryItem = {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  count: number;
};
const defaults: Values = {
  provinces: "50",
  rai_if: "3",
  rai: "2",
  price_end: "3999999.99",
};
const labels: Values = {
  provinces: "จังหวัด",
  amphurSelect: "อำเภอ",
  tambonSelect: "ตำบล",
  region_name: "หน่วยงานที่ขาย",
  asset_type: "ประเภททรัพย์",
  person1: "ชื่อโจทก์",
  start_date: "วันประมูล (วว/ดด/พ.ศ.)",
  price_begin: "ราคาต่ำสุด · บาท",
  price_end: "ราคาสูงสุด · บาท",
  rai_if: "เงื่อนไขพื้นที่ · ไร่",
  rai: "พื้นที่ · ไร่",
  quaterrai_if: "เงื่อนไข · งาน",
  quaterrai: "พื้นที่ · งาน",
  wa_if: "เงื่อนไข · ตร.วา",
  wa: "พื้นที่ · ตร.วา / ตร.ม.",
};
const statuses: Values = {
  queued: "รอเริ่ม",
  searching: "กำลังค้นหา",
  extracting: "กำลังอ่านประกาศ",
  geocoding: "กำลังค้นหาพิกัด",
  completed: "ดึงข้อมูลครบ",
  partial: "มีรายการรอตรวจสอบ",
  failed: "ดึงข้อมูลไม่สำเร็จ",
  cancelled: "หยุดแล้ว",
  interrupted: "งานถูกขัดจังหวะ",
  located: "พบพิกัด",
  pending: "รอค้นหาพิกัด",
  needs_review: "รอตรวจสอบ",
};
const activeStates = [
  "queued",
  "searching",
  "extracting",
  "geocoding",
  "waiting_login",
];
const money = (n: number | null) =>
  n === null
    ? "ไม่พบราคา"
    : new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 }).format(n);
const shortMoney = (n: number | null) =>
  n === null
    ? "—"
    : n >= 1000000
      ? `${(n / 1000000).toFixed(2)} ล้าน`
      : `${Math.round(n / 1000)}k`;
const dateTime = (d: string) =>
  new Date(d).toLocaleString("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const r = await fetch("/api" + path, {
    method,
    headers: { "Content-Type": "application/json", "X-Land-Radar": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    throw Error(e.error || "เชื่อมต่อไม่สำเร็จ");
  }
  return r.status === 204 ? (undefined as T) : r.json();
}
function FitMap({
  points,
  selected,
  reset,
}: {
  points: [number, number][];
  selected: Property | null;
  reset: number;
}) {
  const map = useMap();
  useEffect(() => {
    if (points.length && !selected)
      map.fitBounds(L.latLngBounds(points), { padding: [65, 65], maxZoom: 14 });
  }, [map, JSON.stringify(points), reset]);
  useEffect(() => {
    const p = selected?.parcels.find(
      (p) => p.latitude !== null && p.longitude !== null,
    );
    if (p) map.flyTo([p.latitude!, p.longitude!], 15, { duration: 0.6 });
  }, [map, selected?.id]);
  return null;
}
function App() {
  const [schema, setSchema] = useState<Schema | null>(null),
    [values, setValues] = useState<Values>({}),
    [bookmarks, setBookmarks] = useState<Saved[]>([]),
    [history, setHistory] = useState<HistoryItem[]>([]);
  const [job, setJob] = useState<Job | null>(null),
    [selected, setSelected] = useState<Property | null>(null),
    [captcha, setCaptcha] = useState(""),
    [name, setName] = useState("เชียงใหม่ · ที่ดินมากกว่า 2 ไร่");
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [tab, setTab] = useState("search"),
    [advanced, setAdvanced] = useState(false),
    [query, setQuery] = useState(""),
    [type, setType] = useState(""),
    [reset, setReset] = useState(0),
    [image, setImage] = useState(""),
    [database, setDatabase] = useState(false);
  const active = !!job && activeStates.includes(job.status);
  const jobId = useRef<string | null>(null);
  async function action(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function loadSchema(refresh = true) {
    const s = await api<Schema>("/schema", "POST", { refresh });
    setSchema(s);
    setValues(
      Object.fromEntries(
        s.fields.map((f) => [f.key, defaults[f.key] ?? f.value]),
      ),
    );
    setCaptcha("");
  }
  async function refreshSaved() {
    const [b, h] = await Promise.all([
      api<Saved[]>("/bookmarks"),
      api<HistoryItem[]>("/jobs"),
    ]);
    setBookmarks(b);
    setHistory(h);
  }
  useEffect(() => {
    void action("กำลังเชื่อมต่อ", async () => {
      await api("/health");
      setDatabase(true);
      await refreshSaved();
      const a = await api<{ id: string | null }>("/active");
      if (a.id) {
        jobId.current = a.id;
        setJob(await api<Job>("/jobs/" + a.id));
      } else await loadSchema();
    });
  }, []);
  useEffect(() => {
    setSelected((current) =>
      current ? job?.properties.find((p) => p.id === current.id) || null : null,
    );
  }, [job]);
  useEffect(() => {
    if (!active || !job) return;
    const timer = setInterval(async () => {
      try {
        const j = await api<Job>("/jobs/" + job.id);
        if (jobId.current === j.id) {
          setJob(j);
          if (!activeStates.includes(j.status)) {
            void refreshSaved();
            if (!schema) void action("กำลังโหลดตัวกรอง", () => loadSchema());
          }
        }
      } catch (e) {
        setError((e as Error).message);
      }
    }, 1800);
    return () => clearInterval(timer);
  }, [active, job?.id]);
  async function change(key: string, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
    if (["provinces", "amphurSelect"].includes(key))
      await action("กำลังอัปเดตตัวเลือก", async () => {
        const s = await api<Schema>("/schema/select", "POST", { key, value });
        setSchema(s);
        setValues((v) => ({
          ...v,
          ...(key === "provinces"
            ? { amphurSelect: "", tambonSelect: "" }
            : { tambonSelect: "" }),
        }));
      });
  }
  async function loadBookmark(b: Saved) {
    await action("กำลังโหลด bookmark", async () => {
      let s = await api<Schema>("/schema", "POST", { refresh: true });
      for (const key of ["provinces", "amphurSelect", "tambonSelect"])
        if (b.values[key])
          s = await api<Schema>("/schema/select", "POST", {
            key,
            value: b.values[key],
          });
      const known = new Set(s.fields.map((f) => f.key));
      const missing = Object.keys(b.values).filter((k) => !known.has(k));
      if (missing.length)
        throw Error(
          `ตัวกรองต้นทางเปลี่ยน: ${missing.join(", ")} กรุณาสร้าง bookmark ใหม่`,
        );
      setSchema(s);
      setValues({
        ...Object.fromEntries(s.fields.map((f) => [f.key, f.value])),
        ...b.values,
      });
      setName(b.name);
      setCaptcha("");
      setTab("search");
      setNotice("โหลดเงื่อนไขแล้ว กรอกรหัสยืนยันเพื่อเริ่ม Retrieve");
    });
  }
  function field(key: string) {
    const f = schema?.fields.find((f) => f.key === key);
    if (!f) return null;
    return (
      <label className="field" key={key}>
        <span>{labels[key] || f.label}</span>
        {f.kind === "select" ? (
          <div className="select-wrap">
            <select
              aria-label={labels[key] || f.label}
              value={values[key] ?? ""}
              onChange={(e) => void change(key, e.target.value)}
              disabled={!!busy || active}
            >
              {f.options.map((o, i) => (
                <option key={o.value + i} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
          </div>
        ) : (
          <input
            aria-label={labels[key] || f.label}
            value={values[key] ?? ""}
            onChange={(e) =>
              setValues((v) => ({ ...v, [key]: e.target.value }))
            }
            disabled={!!busy || active}
            placeholder="ไม่กำหนด"
            inputMode={
              ["rai", "quaterrai", "wa", "price_begin", "price_end"].includes(
                key,
              )
                ? "decimal"
                : "text"
            }
          />
        )}
      </label>
    );
  }
  const filtered = useMemo(
    () =>
      job?.properties.filter(
        (p) =>
          (!type || p.propertyType === type) &&
          [p.title, p.deed, p.district, p.subdistrict]
            .join(" ")
            .includes(query),
      ) || [],
    [job, query, type],
  );
  const mapped = filtered.flatMap((p) =>
    p.parcels
      .filter((v) => v.latitude !== null && v.longitude !== null)
      .map((parcel) => ({ property: p, parcel })),
  );
  const points = mapped.map(
    ({ parcel: p }) => [p.latitude!, p.longitude!] as [number, number],
  );
  const located =
    job?.properties.filter((p) => p.status === "located").length || 0;
  async function retrieve() {
    await action("กำลังเริ่มงาน", async () => {
      const r = await api<{ id: string }>("/jobs", "POST", {
        name,
        values,
        captcha,
      });
      jobId.current = r.id;
      setJob(await api<Job>("/jobs/" + r.id));
      setSelected(null);
      setCaptcha("");
      setQuery("");
      setType("");
      setNotice("เริ่มดึงข้อมูลแล้ว คุณเปิดดูความคืบหน้าได้บนแผนที่");
    });
  }
  async function retry() {
    if (!job) return;
    await action("กำลังค้นหาพิกัดอีกครั้ง", async () => {
      await api("/jobs/" + job.id + "/retry", "POST");
      setJob({
        ...job,
        status: "geocoding",
        message: "กำลังค้นหาพิกัดที่ยังขาด",
      });
    });
  }
  function exportData() {
    if (!job) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(job, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `land-radar-${job.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-icon">
            <Compass size={25} />
          </span>
          <div>
            LAND<span>RADAR</span>
            <small>สำรวจทรัพย์ ค้นพบโอกาส</small>
          </div>
        </a>
        <div className="top-center">
          <span className="live-dot" /> LOCAL WORKSPACE{" "}
          <span className="divider">/</span> LED × LANDSMAPS
        </div>
        <div className="db-state">
          <Database size={15} />
          <span>{database ? "เชื่อมต่อ PostgreSQL" : "กำลังเชื่อมต่อ"}</span>
          <i className={database ? "on" : ""} />
        </div>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-heading">
            <span className="eyebrow">YOUR PROPERTY EXPLORER</span>
            <h1>
              เริ่มจากที่ดิน
              <br />
              ที่คุณกำลังมองหา<span>.</span>
            </h1>
            <p>
              ค้นหาประกาศขายทอดตลาด
              <br />
              และดูตำแหน่งแปลงที่ดินในที่เดียว
            </p>
          </div>
          <nav className="tabs">
            <button
              className={tab === "search" ? "active" : ""}
              onClick={() => setTab("search")}
            >
              <SlidersHorizontal size={15} />
              ค้นหา
            </button>
            <button
              className={tab === "saved" ? "active" : ""}
              onClick={() => setTab("saved")}
            >
              <Bookmark size={15} />
              บันทึก <b>{bookmarks.length}</b>
            </button>
            <button
              className={tab === "history" ? "active" : ""}
              onClick={() => setTab("history")}
            >
              <History size={15} />
              ประวัติ
            </button>
          </nav>
          <div className="sidebar-content">
            {tab === "search" ? (
              <>
                <div className="section-label">
                  <span>01 — เงื่อนไขการค้นหา</span>
                  <button
                    title="อ่านตัวกรองใหม่จากเว็บต้นทาง"
                    disabled={!!busy || active}
                    onClick={() =>
                      void action("กำลังซิงก์ตัวกรอง", () => loadSchema())
                    }
                  >
                    <RefreshCw size={14} />
                  </button>
                </div>
                {!schema ? (
                  <div className="loading-box">
                    <LoaderCircle className="spin" size={24} />
                    <p>{busy || "โหลดตัวกรองเพื่อเริ่มค้นหา"}</p>
                    <button
                      className="secondary"
                      disabled={!!busy || active}
                      onClick={() =>
                        void action("กำลังโหลดตัวกรอง", () => loadSchema())
                      }
                    >
                      โหลดตัวกรอง
                    </button>
                  </div>
                ) : (
                  <>
                    {field("provinces")}
                    <div className="field-pair">
                      {field("amphurSelect")}
                      {field("tambonSelect")}
                    </div>
                    {field("asset_type")}
                    <div className="field-pair">
                      {field("rai_if")}
                      {field("rai")}
                    </div>
                    <div className="field-pair">
                      {field("price_begin")}
                      {field("price_end")}
                    </div>
                    <p className="field-hint">
                      มากกว่า 2 ไร่ = มากกว่า 800 ตร.วา
                      <br />
                      ราคาต่ำกว่า 4 ล้าน ตั้งเพดาน 3,999,999.99 บาท
                    </p>
                    <button
                      className="advanced"
                      onClick={() => setAdvanced(!advanced)}
                    >
                      <SlidersHorizontal size={14} />
                      ตัวกรองเพิ่มเติม{" "}
                      <ChevronDown
                        size={14}
                        className={advanced ? "rotate" : ""}
                      />
                    </button>
                    {advanced && (
                      <div className="advanced-fields">
                        {schema.fields
                          .filter(
                            (f) =>
                              ![
                                "provinces",
                                "amphurSelect",
                                "tambonSelect",
                                "asset_type",
                                "rai_if",
                                "rai",
                                "price_begin",
                                "price_end",
                              ].includes(f.key),
                          )
                          .map((f) => field(f.key))}
                      </div>
                    )}
                    <div className="save-section">
                      <label className="field">
                        <span>ชื่อชุดการค้นหา</span>
                        <input
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          maxLength={120}
                        />
                      </label>
                      <button
                        className="save-button"
                        disabled={!name.trim() || !!busy || active}
                        onClick={() =>
                          void action("กำลังบันทึก", async () => {
                            const id = crypto.randomUUID();
                            await api("/bookmarks/" + id, "PUT", {
                              id,
                              name,
                              values,
                              savedAt: new Date().toISOString(),
                            });
                            await refreshSaved();
                            setNotice("บันทึก bookmark แล้ว");
                          })
                        }
                      >
                        <Bookmark size={15} />
                        บันทึกเงื่อนไขนี้
                      </button>
                    </div>
                    <div className="section-label">
                      <span>02 — ยืนยันและดึงข้อมูล</span>
                    </div>
                    <div className="captcha-row">
                      <div className="captcha-image">
                        <img
                          src={schema.captchaUrl}
                          alt="รหัสยืนยันจากกรมบังคับคดี"
                        />
                      </div>
                      <input
                        aria-label="รหัสยืนยัน"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="กรอกรหัส 6 หลัก"
                        value={captcha}
                        onChange={(e) =>
                          setCaptcha(e.target.value.replace(/\D/g, ""))
                        }
                        disabled={active}
                      />
                    </div>
                    <p className="muted tiny">
                      รหัสจากเว็บต้นทาง ใช้สำหรับการค้นหาครั้งนี้
                    </p>
                    <button
                      className="retrieve"
                      disabled={!!busy || active || captcha.length !== 6}
                      onClick={() => void retrieve()}
                    >
                      {busy || active ? (
                        <LoaderCircle className="spin" size={18} />
                      ) : (
                        <Search size={18} />
                      )}
                      <span>
                        {active ? "กำลังดึงข้อมูล" : "Retrieve ข้อมูล"}
                      </span>
                      <ArrowRight size={18} />
                    </button>
                    <p className="sync-note">
                      <Check size={12} /> ตัวเลือกอัปเดตจากเว็บกรมบังคับคดี
                    </p>
                  </>
                )}
              </>
            ) : tab === "saved" ? (
              <>
                <div className="section-label">
                  BOOKMARKS · {bookmarks.length}
                </div>
                {bookmarks.length === 0 ? (
                  <Empty
                    icon={<Bookmark size={28} />}
                    title="เก็บเงื่อนไขที่ใช้บ่อย"
                    text="บันทึกชุดการค้นหา แล้วเลือกกลับมาดึงข้อมูลรอบใหม่ได้ทันที"
                  />
                ) : (
                  bookmarks.map((b) => (
                    <div className="saved-card" key={b.id}>
                      <Bookmark size={18} />
                      <button
                        disabled={active || !!busy}
                        onClick={() => void loadBookmark(b)}
                      >
                        <strong>{b.name}</strong>
                        <small>{dateTime(b.savedAt)}</small>
                      </button>
                      <button
                        className="icon-button"
                        aria-label={"ลบ " + b.name}
                        onClick={() =>
                          void action("กำลังลบ", async () => {
                            await api("/bookmarks/" + b.id, "DELETE");
                            await refreshSaved();
                          })
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                )}
              </>
            ) : (
              <>
                <div className="section-label">RETRIEVAL HISTORY</div>
                {history.length === 0 ? (
                  <Empty
                    icon={<History size={28} />}
                    title="ยังไม่มีประวัติการค้นหา"
                    text="ผลการดึงแต่ละรอบจะถูกเก็บไว้ พร้อมภาพหลักฐานและตัวกรองที่ใช้"
                  />
                ) : (
                  history.map((h) => (
                    <button
                      key={h.id}
                      className={
                        "history-card " + (job?.id === h.id ? "chosen" : "")
                      }
                      disabled={active}
                      onClick={() =>
                        void action("กำลังเปิดผลค้นหา", async () => {
                          const j = await api<Job>("/jobs/" + h.id);
                          jobId.current = j.id;
                          setJob(j);
                          setSelected(null);
                          setQuery("");
                          setType("");
                        })
                      }
                    >
                      <span className="history-date">
                        {dateTime(h.createdAt)}
                      </span>
                      <strong>{h.name}</strong>
                      <span>
                        {h.count} รายการ <i>·</i>{" "}
                        {statuses[h.status] || h.status}
                      </span>
                    </button>
                  ))
                )}
              </>
            )}
          </div>
          <div className="sidebar-footer">
            <span className="live-dot" /> ข้อมูลและภาพบันทึกในเครื่องของคุณ
          </div>
        </aside>
        <main>
          <div className="main-heading">
            <div>
              <div className="eyebrow">PROPERTY INTELLIGENCE</div>
              <h2>{job ? job.name : "มองเห็นทุกแปลง บนแผนที่เดียว"}</h2>
              <p>
                {job
                  ? `ค้นเมื่อ ${dateTime(job.createdAt)} · ${statuses[job.status] || job.status}`
                  : "จากประกาศ สู่พิกัดที่ดิน — เริ่มค้นหาจากเงื่อนไขด้านซ้าย"}
              </p>
            </div>
            <button
              className="export-button"
              disabled={!job}
              onClick={exportData}
            >
              <ArrowDownToLine size={16} />
              ส่งออกข้อมูล
            </button>
          </div>
          {error && (
            <div role="alert" className="alert error">
              <AlertCircle size={17} />
              <span>{error}</span>
              <button aria-label="ปิดข้อความ" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="alert notice">
              <Check size={16} />
              <span>{notice}</span>
              <button aria-label="ปิดแจ้งเตือน" onClick={() => setNotice("")}>
                <X size={16} />
              </button>
            </div>
          )}
          <div className="stats">
            <Stat
              label="ทรัพย์ที่บันทึก"
              value={job?.properties.length ?? "—"}
              suffix="รายการ"
              icon={<Layers size={19} />}
            />
            <Stat
              label="พบพิกัดครบ"
              value={job ? located : "—"}
              suffix="รายการ"
              icon={<MapPin size={19} />}
            />
            <Stat
              label="รอตรวจสอบ / รอพิกัด"
              value={job ? job.properties.length - located : "—"}
              suffix="รายการ"
              icon={<Crosshair size={19} />}
            />
            <Stat
              label="ข้ามแถวสีแดง"
              value={job?.skippedRed ?? "—"}
              suffix="รายการ"
              icon={<Square size={18} />}
            />
          </div>
          {job && (
            <div className={"progress " + (active ? "running" : "")}>
              <div>
                {active ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Check size={16} />
                )}
                <span>{job.message}</span>
              </div>
              <span>
                อ่าน {job.seen} แถว · {job.pages} หน้า
                {job.excluded > 0 ? ` · ไม่ผ่านเงื่อนไข ${job.excluded}` : ""}
              </span>
              {active && (
                <button
                  onClick={() =>
                    void action("กำลังหยุด", async () => {
                      await api("/cancel", "POST");
                    })
                  }
                >
                  <Square size={12} />
                  หยุด
                </button>
              )}
            </div>
          )}
          {!!job?.warnings.length && (
            <div className="alert error">
              <AlertCircle size={16} />
              {job.warnings.join(" · ")}
            </div>
          )}
          {job &&
            !active &&
            job.properties.some(
              (p) => p.deed && p.status !== "located" && p.status !== "failed",
            ) && (
              <button
                className="retry-button"
                disabled={!!busy}
                onClick={() => void retry()}
              >
                <RefreshCw size={14} />
                ค้นหาพิกัดที่ยังขาดอีกครั้ง
              </button>
            )}
          <section className="results">
            <div className="map-panel">
              <div className="map-label">
                <span className="live-dot" />
                <strong>แผนที่ทรัพย์</strong>
                <span>{mapped.length} หมุด</span>
              </div>
              <MapContainer
                center={[18.85, 99.0]}
                zoom={9}
                zoomControl={false}
                className="map"
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
                  url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <FitMap points={points} selected={selected} reset={reset} />
                {mapped.map(({ property: p, parcel: v }, i) => (
                  <Marker
                    key={`${p.id}-${v.deed}-${i}`}
                    position={[v.latitude!, v.longitude!]}
                    icon={L.divIcon({
                      className:
                        "price-marker " +
                        (selected?.id === p.id ? "selected" : ""),
                      html: `<span>฿ ${shortMoney(p.price)}</span>`,
                      iconSize: [82, 34],
                      iconAnchor: [41, 40],
                    })}
                    eventHandlers={{ click: () => setSelected(p) }}
                  >
                    <Popup>
                      <strong>{p.propertyType}</strong>
                      <br />
                      {p.subdistrict} · {p.district}
                      <br />
                      โฉนด {v.deed}
                      <br />฿ {money(p.price)}
                      <br />
                      <button
                        className="popup-button"
                        onClick={() => {
                          setSelected(p);
                          setImage(p.screenshotUrl);
                        }}
                      >
                        ดูภาพประกาศ
                      </button>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
              <button
                className="fit-button"
                title="แสดงทุกหมุด"
                onClick={() => {
                  setSelected(null);
                  setReset((v) => v + 1);
                }}
              >
                <Crosshair size={20} />
              </button>
              {!job && (
                <div className="map-intro">
                  <div className="intro-symbol">
                    <MapPin size={27} />
                  </div>
                  <div>
                    <strong>โอกาสใหม่ อาจอยู่ใกล้กว่าที่คิด</strong>
                    <p>
                      ผลค้นหาของคุณจะปรากฏที่นี่
                      <br />
                      พร้อมพิกัดและภาพประกาศต้นฉบับ
                    </p>
                  </div>
                </div>
              )}
              {job && mapped.length === 0 && (
                <div className="map-intro small">
                  <Crosshair size={22} />
                  <div>
                    <strong>
                      {active
                        ? "กำลังรวบรวมข้อมูล"
                        : "ยังไม่มีพิกัดสำหรับปักหมุด"}
                    </strong>
                    <p>แสดงเฉพาะพิกัดที่พบจาก LandsMaps</p>
                  </div>
                </div>
              )}
              <div className="map-bottom">
                <span>
                  <i /> พิกัดจาก LandsMaps
                </span>
                <span>ใช้แสดงตำแหน่งโดยสังเขป</span>
              </div>
            </div>
            <div className="list-panel">
              <div className="list-heading">
                <h3>
                  รายการทรัพย์ <span>{filtered.length}</span>
                </h3>
                <div className="list-search">
                  <Search size={15} />
                  <input
                    aria-label="ค้นหาในผลลัพธ์"
                    placeholder="โฉนด ตำบล หรืออำเภอ"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                {job && (
                  <select
                    className="type-filter"
                    aria-label="กรองประเภททรัพย์ในผลลัพธ์"
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                  >
                    <option value="">ทุกประเภททรัพย์</option>
                    {Array.from(
                      new Set(job.properties.map((p) => p.propertyType)),
                    ).map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="property-list">
                {filtered.length === 0 ? (
                  <Empty
                    icon={<MapPin size={32} />}
                    title={
                      job ? "ยังไม่มีรายการที่ตรงกัน" : "พื้นที่สำหรับการค้นพบ"
                    }
                    text={
                      job
                        ? "ลองเปลี่ยนคำค้น หรือรอให้ระบบดึงข้อมูลเสร็จ"
                        : "ตั้งเงื่อนไข กรอกรหัสยืนยัน แล้วกด Retrieve เพื่อเริ่มสำรวจทรัพย์"
                    }
                  />
                ) : (
                  filtered.map((p, i) => (
                    <button
                      className={
                        "property-card " +
                        (selected?.id === p.id ? "chosen" : "")
                      }
                      key={p.id}
                      onClick={() => setSelected(p)}
                    >
                      <div className="property-top">
                        <span className="property-index">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className={"status-pill " + p.status}>
                          {statuses[p.status]}
                        </span>
                      </div>
                      <h4>{p.propertyType}</h4>
                      <p className="location">
                        <MapPin size={13} />
                        {p.subdistrict} · {p.district}
                      </p>
                      <div className="property-facts">
                        <span>{p.areaText}</span>
                        <strong>฿ {money(p.price)}</strong>
                      </div>
                      <div className="property-bottom">
                        <span>โฉนด {p.deed || "รออ่านรายละเอียด"}</span>
                        <ImageIcon size={15} />
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </section>
          <footer className="main-footer">
            <span>
              แหล่งข้อมูล{" "}
              <a
                href="https://asset.led.go.th/newbidreg/default.asp"
                target="_blank"
                rel="noreferrer"
              >
                กรมบังคับคดี <ExternalLink size={10} />
              </a>
              <a
                href="https://landsmaps.dol.go.th/"
                target="_blank"
                rel="noreferrer"
              >
                LandsMaps <ExternalLink size={10} />
              </a>
            </span>
            <span>ราคาที่แสดงเป็นราคาประเมินตามประกาศ</span>
          </footer>
        </main>
      </div>
      {selected && (
        <div
          className="detail-drawer"
          role="dialog"
          aria-label="รายละเอียดทรัพย์"
        >
          <div className="detail-header">
            <span className="eyebrow">PROPERTY DETAILS</span>
            <button
              aria-label="ปิดรายละเอียด"
              onClick={() => setSelected(null)}
            >
              <X size={20} />
            </button>
          </div>
          <span className={"status-pill " + selected.status}>
            {statuses[selected.status]}
          </span>
          <h2>{selected.propertyType}</h2>
          <p>
            {selected.subdistrict} · {selected.district} · {selected.province}
          </p>
          <div className="detail-price">
            ฿ {money(selected.price)}
            <small>ราคาประเมิน</small>
          </div>
          <dl>
            <dt>เลขที่โฉนด</dt>
            <dd>{selected.deed || "ไม่พบ"}</dd>
            {selected.landDocument && (
              <>
                <dt>เอกสารสิทธิตามประกาศ</dt>
                <dd>{selected.landDocument}</dd>
              </>
            )}
            <dt>เนื้อที่</dt>
            <dd>{selected.areaText}</dd>
            <dt>วันประมูลตามประกาศ</dt>
            <dd>{selected.auctionDates.join(" · ") || "ยังอ่านไม่ได้"}</dd>
            <dt>บันทึกเมื่อ</dt>
            <dd>{dateTime(selected.retrievedAt)}</dd>
          </dl>
          {selected.error && <p className="detail-error">{selected.error}</p>}
          {selected.parcels.map((p, i) => (
            <div className="parcel-detail" key={i}>
              <strong>โฉนด {p.deed}</strong>
              <span>
                {p.latitude !== null ? `${p.latitude}, ${p.longitude}` : p.note}
              </span>
              {p.evidenceUrl && (
                <button onClick={() => setImage(p.evidenceUrl!)}>
                  ภาพหลักฐาน LandsMaps <ExternalLink size={12} />
                </button>
              )}
            </div>
          ))}
          {selected.screenshotUrl ? (
            <button
              className="evidence-preview"
              onClick={() => setImage(selected.screenshotUrl)}
            >
              <img
                src={selected.screenshotUrl}
                alt="ภาพประกาศต้นฉบับจากกรมบังคับคดี"
              />
              <span>
                <ImageIcon size={16} />
                ขยายภาพประกาศต้นฉบับ
              </span>
            </button>
          ) : (
            <p className="muted">ยังไม่มีภาพประกาศ</p>
          )}
        </div>
      )}
      {image && (
        <div className="lightbox" role="dialog" aria-label="ภาพหลักฐาน">
          <div>
            <strong>ภาพหลักฐานจากเว็บต้นทาง</strong>
            <a href={image} download>
              <ArrowDownToLine size={18} />
              บันทึกภาพ
            </a>
            <button aria-label="ปิดภาพ" onClick={() => setImage("")}>
              <X size={24} />
            </button>
          </div>
          <section>
            <img src={image} alt="ภาพหลักฐานฉบับเต็ม" />
          </section>
        </div>
      )}
    </div>
  );
}
function Stat({
  label,
  value,
  suffix,
  icon,
}: {
  label: string;
  value: string | number;
  suffix: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="stat">
      <div>
        <span>{label}</span>
        <strong>
          {value}
          <small>{suffix}</small>
        </strong>
      </div>
      <div className="stat-icon">{icon}</div>
    </div>
  );
}
function Empty({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="empty">
      <div>{icon}</div>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
