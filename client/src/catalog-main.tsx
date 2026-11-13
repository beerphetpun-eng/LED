import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import {
  Compass,
  RefreshCw,
  SlidersHorizontal,
  MapPin,
  Bookmark,
  Star,
  Maximize2,
  Minimize2,
  X,
  Search,
  Database,
  PanelLeftClose,
  PanelLeftOpen,
  ArrowDownToLine,
  Settings as SettingsIcon,
} from "lucide-react";
import type {
  Property,
  Library,
  Filters,
  SyncResponse,
  Province,
  UserNotes,
} from "./catalog-types";
import { api, money, time } from "./catalog-api";
import { SyncPanel } from "./SyncPanel";
import { PropertyDetails } from "./PropertyDetails";
import { AlertMenu } from "./AlertMenu";
import { PropertyTable } from "./PropertyTable";
import "leaflet/dist/leaflet.css";
import "./catalog.css";
const emptyLibrary: Library = {
  items: [],
  total: 0,
  facets: { provinces: [], districts: [], types: [], maxPrice: 0, maxRai: 0 },
};
function ViewMap({
  items,
  full,
  visible,
  selected,
  focusSelected,
}: {
  items: Property[];
  full: boolean;
  visible: boolean;
  selected: Property | null;
  focusSelected: boolean;
}) {
  const map = useMap();
  const coordinates = items.flatMap((p) =>
    p.parcels
      .filter((v) => v.latitude !== null && v.longitude !== null)
      .map((v) => [v.latitude!, v.longitude!] as [number, number]),
  );
  const key = JSON.stringify(coordinates);
  const fittedView = useRef("");
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width && entry.contentRect.height)
        map.invalidateSize();
    });
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  useEffect(() => {
    if (!visible) return;
    map.invalidateSize();
    const view = `${full}:${key}`;
    if (fittedView.current === view) return;
    fittedView.current = view;
    if (coordinates.length && !selected)
      map.fitBounds(L.latLngBounds(coordinates), {
        padding: [45, 45],
        maxZoom: 14,
      });
  }, [key, full, visible]);
  useEffect(() => {
    if (!focusSelected || !visible) return;
    const p = selected?.parcels.find(
      (v) => v.latitude !== null && v.longitude !== null,
    );
    if (p) map.flyTo([p.latitude!, p.longitude!], 16);
  }, [selected?.id, focusSelected, visible]);
  return null;
}
function App() {
  const [library, setLibrary] = useState<Library>(emptyLibrary),
    [sync, setSync] = useState<SyncResponse | null>(null),
    [geography, setGeography] = useState<Province[]>([]),
    [tab, setTab] = useState("explore"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [full, setFull] = useState(false),
    [filtersCollapsed, setFiltersCollapsed] = useState(true),
    [view, setView] = useState<"map" | "list">("map"),
    [listMode, setListMode] = useState<"cards" | "table">("table"),
    [image, setImage] = useState(""),
    [selected, setSelected] = useState<Property | null>(null),
    [focusSelected, setFocusSelected] = useState(false),
    [filters, setFilters] = useState<Filters>(() => {
      try {
        return JSON.parse(
          localStorage.getItem("land-radar-view-filters") || "{}",
        );
      } catch {
        return {};
      }
    }),
    [loading, setLoading] = useState(true);
  const filtersRef = useRef(filters),
    requestNumber = useRef(0),
    selectedId = useRef<string | null>(null);
  filtersRef.current = filters;
  selectedId.current = selected?.id || null;
  async function report<T>(label: string, fn: () => Promise<T>) {
    setBusy(label);
    setError("");
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy("");
    }
  }
  const act = (label: string, fn: () => Promise<unknown>) => {
    void report(label, fn).catch(() => {});
  };
  async function loadLibrary() {
    const request = ++requestNumber.current;
    const q = new URLSearchParams(
      Object.entries(filtersRef.current).filter(([, v]) => v !== ""),
    );
    const l = await api<Library>("/properties?" + q);
    if (request === requestNumber.current) {
      setLibrary(l);
      setLoading(false);
    }
  }
  async function loadSync() {
    const s = await api<SyncResponse>("/sync");
    setSync(s);
    return s;
  }
  useEffect(() => {
    act("กำลังเชื่อมต่อ", async () => {
      const [g] = await Promise.all([
        api<{ provinces: Province[] }>("/geography"),
        loadLibrary(),
        loadSync(),
      ]);
      setGeography(g.provinces);
    });
    let n = 0;
    const timer = setInterval(() => {
      void loadSync()
        .then(async (s) => {
          if (++n % 3 === 0 || !s.runtime.running) {
            await loadLibrary();
            const id = selectedId.current;
            if (id) {
              const p = await api<Property>("/properties/" + id);
              if (selectedId.current === id) setSelected(p);
            }
          }
        })
        .catch((e) => setError(e.message));
    }, 3000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    localStorage.setItem("land-radar-view-filters", JSON.stringify(filters));
    const timer = setTimeout(() => {
      void loadLibrary().catch((e) => {
        setLoading(false);
        setError(e.message);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [filters]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (image) setImage("");
        else if (selected) setSelected(null);
        else setFull(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [image, selected]);
  function filter(key: string, value: string) {
    setFilters((f) => ({
      ...f,
      [key]: value,
      ...(key === "province" ? { district: "" } : {}),
    }));
  }
  async function select(p: Property, focusMap = true) {
    await report("กำลังอ่านรายละเอียด", async () => {
      const d = await api<Property>("/properties/" + p.id);
      setFocusSelected(focusMap);
      setSelected(d);
    });
  }
  async function saveUser(user: UserNotes) {
    if (!selected) return;
    await report("กำลังบันทึก", async () => {
      const p = await api<Property>(
        "/properties/" + selected.id + "/user",
        "PATCH",
        user,
      );
      setSelected(p);
      await loadLibrary();
    });
  }
  async function facebook(days: number) {
    if (!selected) return;
    const id = selected.id;
    await report("กำลังอ่าน Facebook", async () => {
      const p = await api<Property>("/properties/" + id + "/facebook", "POST", {
        nearbyDays: days,
      });
      if (selectedId.current === id) setSelected(p);
      await loadSync();
    });
  }
  function exportJSON() {
    const blob = new Blob([JSON.stringify(library.items, null, 2)], {
        type: "application/json",
      }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = "land-radar-properties.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const mapped = library.items.filter((p) =>
      p.parcels.some((v) => v.latitude !== null && v.longitude !== null),
    ),
    pins = mapped.flatMap((p) =>
      p.parcels
        .filter((v) => v.latitude !== null && v.longitude !== null)
        .map((v) => ({ p, v })),
    );
  const field = (
    label: string,
    key: string,
    options: string[] | { value: string; label: string }[],
  ) => (
    <label>
      {label}
      <select
        value={filters[key] || ""}
        onChange={(e) => filter(key, e.target.value)}
      >
        <option value="">ทั้งหมด</option>
        {options.map((o) =>
          typeof o === "string" ? (
            <option key={o} value={o}>
              {o}
            </option>
          ) : (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ),
        )}
      </select>
    </label>
  );
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-symbol">
            <Compass />
          </span>
          <span>
            LAND<b>RADAR</b>
            <small>พื้นที่ที่คุณเลือก · ข้อมูลที่คุณติดตาม</small>
          </span>
        </a>
        <nav>
          <button
            className={tab === "explore" ? "active" : ""}
            onClick={() => setTab("explore")}
          >
            <MapPin size={16} />
            สำรวจทรัพย์
          </button>
          <button
            className={tab === "sync" ? "active" : ""}
            onClick={() => setTab("sync")}
          >
            <SettingsIcon size={16} />
            ตั้งค่าซิงค์
          </button>
          <AlertMenu
            alerts={sync?.alerts || []}
            error={error}
            onClearError={() => setError("")}
            onDismiss={(id) =>
              act("รับทราบ", async () => {
                await api(`/alerts/${id}/resolve`, "POST");
                await loadSync();
              })
            }
          />
          <button onClick={exportJSON} disabled={!library.items.length}>
            <ArrowDownToLine size={15} /> ส่งออก JSON
          </button>
        </nav>
        <span className="db-badge">
          <Database size={14} />
          {sync ? "PostgreSQL · ในเครื่อง" : "กำลังเชื่อมต่อ"}
        </span>
      </header>
      {tab === "sync" ? (
        <main className="sync-page">
          <section className="sync-strip">
            <div>
              <span
                className={
                  sync?.runtime.running ? "status-dot pulsing" : "status-dot"
                }
              />
              <strong>{sync?.runtime.message || "กำลังโหลดสถานะ"}</strong>
              <small>
                {sync?.runtime.running
                  ? sync.runtime.status === "geocoding"
                    ? `ค้นพิกัดแล้ว ${sync.runtime.geoDone || 0}/${sync.runtime.geoTotal || 0} ประกาศ`
                    : `ขอบเขต ${sync.runtime.scopeIndex || 0}/${sync.runtime.scopeCount || 0} · ${sync.runtime.seen || 0} แถว · ${sync.runtime.pages || 0} หน้า · ข้ามรายการเดิม ${sync.runtime.skippedExisting || 0}`
                  : `ซิงค์อัตโนมัติ ${sync?.settings.enabled ? "เปิด" : "ปิด"} · รอบถัดไป ${time(sync?.runtime.nextRunAt)}`}
              </small>
              {(sync?.runtime.geoRetryAt || sync?.runtime.nextGeoRunAt) && (
                <small>
                  {sync.runtime.geoRetryAt &&
                    sync.runtime.status !== "waiting_limit" &&
                    sync.runtime.quotaMessage &&
                    `${sync.runtime.quotaMessage} · `}
                  {sync.settings.enabled
                    ? "รอบค้นพิกัดถัดไป"
                    : "ปิดการค้นพิกัดอัตโนมัติ"}
                  {sync.settings.enabled &&
                    ` ${time(sync.runtime.geoRetryAt || sync.runtime.nextGeoRunAt)}`}
                </small>
              )}
            </div>
            <div className="sync-actions">
              {sync?.runtime.running ? (
                <button
                  onClick={() =>
                    act("กำลังหยุด", async () => {
                      await api("/sync/cancel", "POST");
                      await loadSync();
                    })
                  }
                >
                  หยุดซิงค์
                </button>
              ) : (
                <>
                  <button
                    disabled={!!busy || !sync}
                    onClick={() =>
                      act("เริ่มซิงค์", async () => {
                        await api("/sync/start", "POST");
                        await loadSync();
                      })
                    }
                  >
                    <RefreshCw size={15} />
                    ซิงค์ด้วยตนเอง
                  </button>
                  <button
                    disabled={
                      !!busy ||
                      !library.total ||
                      !!(
                        sync?.runtime.geoRetryAt &&
                        Date.parse(sync.runtime.geoRetryAt) > Date.now()
                      )
                    }
                    onClick={() =>
                      act("ค้นพิกัด", async () => {
                        await api("/sync/geocode", "POST");
                        await loadSync();
                      })
                    }
                  >
                    ค้นพิกัดที่ยังขาด
                  </button>
                </>
              )}
            </div>
          </section>
          {sync && geography.length > 0 ? (
            <SyncPanel
              provinces={geography}
              initial={sync.settings}
              disabled={sync.runtime.running}
              onSave={(s) =>
                report("บันทึกการตั้งค่า", async () => {
                  await api("/sync/settings", "PUT", s);
                  await loadSync();
                })
              }
            />
          ) : (
            <div className="empty">กำลังอ่านรายชื่อจังหวัดและอำเภอ…</div>
          )}
          <p className="muted">
            ระบบทำงานขณะโปรแกรมเปิดอยู่
            หากปิดเครื่องจะเริ่มตรวจรอบที่ครบกำหนดเมื่อเปิดอีกครั้ง
            {sync?.lastCleanup &&
              ` · ล้างข้อมูลหมดอายุล่าสุด ${sync.lastCleanup.deleted} รายการ (${time(sync.lastCleanup.at)})`}
          </p>
        </main>
      ) : (
        <main
          className={`explorer${filtersCollapsed ? " filters-collapsed" : ""}`}
        >
          {filtersCollapsed && (
            <aside className="filter-rail">
              <button
                aria-label="เปิดแถบตัวกรอง"
                title="เปิดแถบตัวกรอง"
                aria-expanded={false}
                aria-controls="library-filters"
                onClick={() => setFiltersCollapsed(false)}
              >
                <PanelLeftOpen size={18} />
              </button>
            </aside>
          )}
          <aside
            className="filters"
            id="library-filters"
            hidden={filtersCollapsed}
          >
            <div className="filter-heading">
              <span className="eyebrow">YOUR PROPERTY LIBRARY</span>
              <button
                aria-label="ซ่อนแถบตัวกรอง"
                title="ซ่อนแถบตัวกรอง"
                aria-expanded={true}
                aria-controls="library-filters"
                onClick={() => setFiltersCollapsed(true)}
              >
                <PanelLeftClose size={18} />
              </button>
            </div>
            <h1>
              ทุกทรัพย์ที่ติดตาม
              <br />
              <em>ในแผนที่เดียว.</em>
            </h1>
            <p className="muted">
              กรองจากฐานข้อมูลของคุณ เปลี่ยนได้อิสระโดยไม่กระทบขอบเขตซิงค์
            </p>
            <div className="filter-title">
              <SlidersHorizontal size={16} />
              <strong>ตัวกรองแสดงผล</strong>
              <button onClick={() => setFilters({})}>ล้าง</button>
            </div>
            <label className="search-box">
              <Search size={16} />
              <input
                aria-label="ค้นหาทรัพย์"
                placeholder="เลขคดี โฉนด ลำดับ หรือคอมเมนต์"
                value={filters.q || ""}
                onChange={(e) => filter("q", e.target.value)}
              />
            </label>
            {field("จังหวัด", "province", library.facets.provinces)}
            {field("อำเภอ", "district", library.facets.districts)}
            {field("ประเภททรัพย์", "type", library.facets.types)}
            <div className="range">
              <label>
                ราคารวมต่ำสุด
                <input
                  aria-label="ราคาต่ำสุด"
                  type="number"
                  min="0"
                  value={filters.minPrice || ""}
                  placeholder="0"
                  onChange={(e) => filter("minPrice", e.target.value)}
                />
              </label>
              <label>
                ราคารวมสูงสุด
                <input
                  aria-label="ราคาสูงสุด"
                  type="number"
                  min="0"
                  value={filters.maxPrice || ""}
                  placeholder={money(library.facets.maxPrice)}
                  onChange={(e) => filter("maxPrice", e.target.value)}
                />
              </label>
            </div>
            <small className="hint">
              สูงสุดในฐานข้อมูล ฿ {money(library.facets.maxPrice)}
            </small>
            <div className="range">
              <label>
                เนื้อที่ต่ำสุด (ไร่)
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={filters.minRai || ""}
                  onChange={(e) => filter("minRai", e.target.value)}
                />
              </label>
              <label>
                เนื้อที่สูงสุด (ไร่)
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={filters.maxRai || ""}
                  onChange={(e) => filter("maxRai", e.target.value)}
                />
              </label>
            </div>
            {field(
              "คะแนนดาว",
              "stars",
              [0, 1, 2, 3, 4, 5].map((n) => ({
                value: String(n),
                label: n + " ดาว",
              })),
            )}
            {field("สถานะที่ผู้ใช้กรอก", "auctionStatus", [
              { value: "auctioning", label: "ยังอยู่ในสถานะประมูล" },
              { value: "ended", label: "จบการประมูลแล้ว" },
              { value: "unset", label: "ยังไม่ระบุ" },
            ])}
            <label className="check bookmark-filter">
              <input
                type="checkbox"
                checked={filters.bookmarked === "true"}
                onChange={(e) =>
                  filter("bookmarked", e.target.checked ? "true" : "")
                }
              />
              <Bookmark size={15} />
              เฉพาะที่บุ๊กมาร์ก
            </label>
          </aside>
          <section className="results">
            <div className="results-toolbar">
              <div
                className="result-tabs"
                role="tablist"
                aria-label="มุมมองผลค้นหา"
                onKeyDown={(e) => {
                  if (
                    !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
                  )
                    return;
                  e.preventDefault();
                  const next =
                    e.key === "Home"
                      ? "map"
                      : e.key === "End"
                        ? "list"
                        : view === "map"
                          ? "list"
                          : "map";
                  setView(next);
                  document.getElementById(`${next}-tab`)?.focus();
                }}
              >
                <button
                  id="map-tab"
                  role="tab"
                  aria-selected={view === "map"}
                  tabIndex={view === "map" ? 0 : -1}
                  aria-controls="property-map"
                  onClick={() => setView("map")}
                >
                  <MapPin size={16} /> แผนที่
                </button>
                <button
                  id="list-tab"
                  role="tab"
                  aria-selected={view === "list"}
                  tabIndex={view === "list" ? 0 : -1}
                  aria-controls="property-list"
                  onClick={() => setView("list")}
                >
                  รายการทรัพย์ <span>{library.items.length}</span>
                </button>
              </div>
              <dl className="stats" aria-label="สรุปผลค้นหา">
                <div>
                  <dt>ทั้งหมด</dt>
                  <dd>{library.total}</dd>
                </div>
                <div>
                  <dt>ตรงตัวกรอง</dt>
                  <dd>{library.items.length}</dd>
                </div>
                <div>
                  <dt>ทรัพย์มีพิกัด</dt>
                  <dd>{mapped.length}</dd>
                </div>
                <div>
                  <dt>หมุด</dt>
                  <dd>{pins.length}</dd>
                </div>
              </dl>
              {view === "list" && (
                <label className="list-mode">
                  มุมมอง
                  <select
                    value={listMode}
                    onChange={(e) =>
                      setListMode(
                        e.target.value === "table" ? "table" : "cards",
                      )
                    }
                  >
                    <option value="table">ตาราง</option>
                    <option value="cards">การ์ด</option>
                  </select>
                </label>
              )}
            </div>
            <section
              id="property-map"
              role="tabpanel"
              aria-labelledby="map-tab"
              hidden={view !== "map"}
            >
              <div className={full ? "map-shell expanded" : "map-shell"}>
                <div className="map-label">
                  <MapPin size={15} />
                  แผนที่ทรัพย์ <b>{pins.length} หมุด</b>
                </div>
                <button
                  className="expand-map"
                  aria-label={full ? "ย่อแผนที่" : "ขยายแผนที่"}
                  onClick={() => setFull((v) => !v)}
                >
                  {full ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
                <MapContainer
                  center={[18.7883, 98.9853]}
                  zoom={10}
                  zoomControl={true}
                >
                  <TileLayer
                    url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
                  />
                  <ViewMap
                    items={library.items}
                    full={full}
                    visible={view === "map" && tab === "explore"}
                    selected={selected}
                    focusSelected={focusSelected}
                  />
                  {pins.map(({ p, v }) => (
                    <Marker
                      key={p.id + v.deed}
                      position={[v.latitude!, v.longitude!]}
                      icon={L.divIcon({
                        className: "price-marker",
                        html: `<span>${p.pricing.total === null ? "รอตรวจราคา" : `฿ ${money(p.pricing.total)}`}</span>`,
                        iconSize: [105, 35],
                        iconAnchor: [52, 35],
                      })}
                      eventHandlers={{
                        click: () => {
                          void select(p, false).catch(() => {});
                        },
                      }}
                    >
                      <Popup autoPan={false}>
                        <b>{p.propertyType}</b>
                        <p>
                          ลำดับ {p.assetSequence} · คดี {p.caseNumber}
                        </p>
                        <button
                          onClick={() => void select(p, false).catch(() => {})}
                        >
                          ดูรายละเอียดและภาพ
                        </button>
                      </Popup>
                    </Marker>
                  ))}
                </MapContainer>
                {!pins.length && (
                  <div className="map-empty">
                    {library.items.length
                      ? "เปิดแท็บรายการทรัพย์เพื่อดูทรัพย์ที่ยังไม่มีพิกัด"
                      : "ผลค้นหาจะแสดงบนแผนที่นี้"}
                    <small>ปักหมุดเฉพาะพิกัดที่ค้นพบจริงจาก LandsMaps</small>
                  </div>
                )}
              </div>
            </section>
            <section
              id="property-list"
              role="tabpanel"
              aria-labelledby="list-tab"
              hidden={view !== "list"}
            >
              {listMode === "table" ? (
                <PropertyTable
                  items={library.items}
                  onSelect={(p) => void select(p).catch(() => {})}
                />
              ) : (
                <div className="property-grid">
                  {library.items.map((p) => (
                    <button
                      className="property-card"
                      key={p.id}
                      onClick={() => void select(p).catch(() => {})}
                    >
                      <div className="card-top">
                        <span>ลำดับ {p.assetSequence}</span>
                        <span>
                          {p.user.bookmarked && (
                            <Bookmark size={14} fill="currentColor" />
                          )}
                          {p.user.stars > 0 && (
                            <>
                              <Star size={14} fill="currentColor" />
                              {p.user.stars}
                            </>
                          )}
                        </span>
                      </div>
                      <h3>{p.propertyType}</h3>
                      <p>
                        {p.subdistrict} · {p.district}
                      </p>
                      <small>
                        คดี {p.caseNumber} · โฉนด {p.deed || "—"}
                      </small>
                      <div className="card-bottom">
                        <span>{p.areaText}</span>
                        <strong>฿ {money(p.pricing.total)}</strong>
                      </div>
                      {p.pricing.carriesMortgage && (
                        <small>รวมจำนองติดไป</small>
                      )}
                      {p.pricing.warning && (
                        <small className="inline-error">
                          {p.pricing.warning}
                        </small>
                      )}
                      <div className="card-status">
                        <span>
                          {p.parcels.some((v) => v.latitude !== null)
                            ? "พบพิกัด"
                            : "รอพิกัด / ตรวจสอบ"}
                        </span>
                        <span>
                          {p.user.auctionStatus === "ended"
                            ? "จบประมูลแล้ว"
                            : p.user.auctionStatus === "auctioning"
                              ? "อยู่ระหว่างประมูล"
                              : "ยังไม่ระบุสถานะ"}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {!library.items.length && (
                <div className="empty">
                  <Compass size={32} />
                  <h3>
                    {loading
                      ? "กำลังอ่านข้อมูล…"
                      : library.total
                        ? "ไม่พบทรัพย์ตรงตัวกรอง"
                        : "เริ่มต้นคลังทรัพย์ชุดใหม่"}
                  </h3>
                  <p>
                    {library.total
                      ? "ลองปรับราคา พื้นที่ หรือดาวที่เลือก"
                      : "ค่าเริ่มต้นซิงค์เชียงใหม่ · เมืองเชียงใหม่ กดซิงค์เพื่อเริ่มดึงข้อมูล"}
                  </p>
                </div>
              )}
            </section>
            <footer>
              แหล่งข้อมูล: กรมบังคับคดี · LandsMaps · Facebook
              สำนักงานบังคับคดีเชียงใหม่
            </footer>
          </section>
        </main>
      )}
      {selected && (
        <PropertyDetails
          key={selected.id}
          property={selected}
          onClose={() => setSelected(null)}
          onSave={(u) => saveUser(u)}
          onFacebook={(d) => facebook(d)}
          onImage={setImage}
        />
      )}
      {image && (
        <div className="lightbox" role="dialog" aria-label="ภาพหลักฐาน">
          <button aria-label="ปิดภาพ" onClick={() => setImage("")}>
            <X />
          </button>
          <a href={image} target="_blank" rel="noreferrer">
            เปิดภาพขนาดเต็ม
          </a>
          <img src={image} alt="ภาพหลักฐานต้นฉบับ" />
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
