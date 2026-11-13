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
  AlertCircle,
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
  selected,
}: {
  items: Property[];
  full: boolean;
  selected: Property | null;
}) {
  const map = useMap();
  const coordinates = items.flatMap((p) =>
    p.parcels
      .filter((v) => v.latitude !== null && v.longitude !== null)
      .map((v) => [v.latitude!, v.longitude!] as [number, number]),
  );
  const key = JSON.stringify(coordinates);
  useEffect(() => {
    map.invalidateSize();
    if (coordinates.length && !selected)
      map.fitBounds(L.latLngBounds(coordinates), {
        padding: [45, 45],
        maxZoom: 14,
      });
  }, [key, full]);
  useEffect(() => {
    const p = selected?.parcels.find(
      (v) => v.latitude !== null && v.longitude !== null,
    );
    if (p) map.flyTo([p.latitude!, p.longitude!], 16);
  }, [selected?.id]);
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
    [image, setImage] = useState(""),
    [selected, setSelected] = useState<Property | null>(null),
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
  async function select(p: Property) {
    await report("กำลังอ่านรายละเอียด", async () => {
      const d = await api<Property>("/properties/" + p.id);
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
        </nav>
        <span className="db-badge">
          <Database size={14} />
          {sync ? "PostgreSQL · ในเครื่อง" : "กำลังเชื่อมต่อ"}
        </span>
      </header>
      <div className="global-alerts" aria-live="polite">
        {error && (
          <div className="alert error" role="alert">
            <AlertCircle size={18} />
            <span>{error}</span>
            <button aria-label="ปิดข้อผิดพลาด" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {sync && sync.alerts.length > 0 && (
          <details className="alert-list" open>
            <summary>
              มีข้อผิดพลาด / รายการที่ต้องตรวจสอบ {sync.alerts.length} ข้อ
            </summary>
            <div className="alert-rows">
              {sync.alerts.map((a) => (
                <div key={a.id}>
                  <span>{a.message}</span>
                  <button
                    onClick={() =>
                      act("รับทราบ", async () => {
                        await api("/alerts/" + a.id + "/resolve", "POST");
                        await loadSync();
                      })
                    }
                  >
                    รับทราบ
                  </button>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
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
          {sync?.runtime.geoRetryAt && (
            <small>
              {sync.settings.enabled
                ? "ค้นพิกัดต่ออัตโนมัติ"
                : "ครบเวลารอโควตา"}{" "}
              {time(sync.runtime.geoRetryAt)}
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
      {tab === "sync" ? (
        <main className="sync-page">
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
        <main className="explorer">
          <aside className="filters">
            <span className="eyebrow">YOUR PROPERTY LIBRARY</span>
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
            <div className="results-heading">
              <div>
                <span className="eyebrow">PROPERTY INTELLIGENCE</span>
                <h2>คลังทรัพย์ของคุณ</h2>
              </div>
              <button onClick={exportJSON} disabled={!library.items.length}>
                <ArrowDownToLine size={15} />
                ส่งออก JSON
              </button>
            </div>
            <div className="stats">
              <div>
                <span>ทรัพย์ทั้งหมด</span>
                <strong>{library.total}</strong>
              </div>
              <div>
                <span>ตรงตัวกรอง</span>
                <strong>{library.items.length}</strong>
              </div>
              <div>
                <span>ทรัพย์ที่มีพิกัด</span>
                <strong>{mapped.length}</strong>
              </div>
              <div>
                <span>หมุดบนแผนที่</span>
                <strong>{pins.length}</strong>
              </div>
            </div>
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
                  selected={selected}
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
                        void select(p).catch(() => {});
                      },
                    }}
                  >
                    <Popup>
                      <b>{p.propertyType}</b>
                      <p>
                        ลำดับ {p.assetSequence} · คดี {p.caseNumber}
                      </p>
                      <button onClick={() => void select(p).catch(() => {})}>
                        ดูรายละเอียดและภาพ
                      </button>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
              {!pins.length && (
                <div className="map-empty">
                  {library.items.length
                    ? "ทรัพย์ที่ยังไม่มีพิกัดจะอยู่ในรายการด้านล่าง"
                    : "ผลค้นหาจะแสดงบนแผนที่นี้"}
                  <small>ปักหมุดเฉพาะพิกัดที่ค้นพบจริงจาก LandsMaps</small>
                </div>
              )}
            </div>
            <div className="list-title">
              <h3>
                รายการทรัพย์ <span>{library.items.length}</span>
              </h3>
              <small>
                {loading ? "กำลังอ่านข้อมูล…" : "ข้อมูลและภาพเก็บในเครื่อง"}
              </small>
            </div>
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
                  {p.pricing.carriesMortgage && <small>รวมจำนองติดไป</small>}
                  {p.pricing.warning && (
                    <small className="inline-error">{p.pricing.warning}</small>
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
            {!library.items.length && (
              <div className="empty">
                <Compass size={32} />
                <h3>
                  {library.total
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
