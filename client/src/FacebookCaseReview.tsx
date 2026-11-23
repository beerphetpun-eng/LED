import { useEffect, useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { api, time } from "./catalog-api";

type ReviewStatus =
  | "matched"
  | "needs_ocr_review"
  | "missing_posts"
  | "awaiting_announcement"
  | "processing"
  | "invalid_case"
  | "incomplete_album";
type Review = {
  checkedAt: string;
  summary: Record<ReviewStatus | "total", number>;
  items: {
    id: string;
    caseNumber: string;
    assetSequence: string;
    status: ReviewStatus;
    eligiblePhotos: number;
    pendingPhotos: number;
    failedPhotos?: number;
    sourceOffice?: string;
    sourceNotice?: string;
    unreadableRows: number;
    otherDatePhotos: string[];
  }[];
};
const labels: Record<ReviewStatus, string> = {
  matched: "พบรูปตรงเลขคดี",
  needs_ocr_review: "มีโพสต์แล้ว · ยังต้องตรวจเลขคดี",
  missing_posts: "ยังไม่มีโพสต์ตรงวันประมูล",
  awaiting_announcement: "รอประกาศนัดอนาคต",
  processing: "กำลังอ่านรูปในคลัง",
  invalid_case: "ต้องตรวจรูปแบบเลขคดี",
  incomplete_album: "อัลบั้มยังดาวน์โหลดไม่ครบ",
};

export function FacebookCaseReview({
  revision,
  onProperty,
}: {
  revision?: string;
  onProperty: (id: string) => Promise<void>;
}) {
  const [data, setData] = useState<Review | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [filter, setFilter] = useState("needs_ocr_review");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let disposed = false;
    let active = false;
    const load = async () => {
      if (active) return;
      active = true;
      setLoading(true);
      try {
        const health = await api<{
          capabilities: { facebookCaseReview?: boolean };
        }>("/health");
        if (!disposed)
          setAvailable(Boolean(health.capabilities.facebookCaseReview));
        if (!health.capabilities.facebookCaseReview) return;
        const report = await api<Review>("/facebook/cases/review");
        if (!disposed) {
          setData(report);
          setError("");
        }
      } catch (error) {
        if (!disposed) {
          setAvailable(true);
          setError((error as Error).message);
        }
      } finally {
        active = false;
        if (!disposed) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [revision, refresh]);
  const items =
    data?.items.filter(
      (item) =>
        (filter === "unresolved"
          ? item.status !== "matched"
          : item.status === filter) &&
        `${item.caseNumber} ${item.assetSequence}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    ) || [];
  if (!available) return null;
  return (
    <details className="facebook-case-review">
      <summary>
        ตรวจการจับคู่เลขคดีทุกทรัพย์{" "}
        {data
          ? `· พบ ${data.summary.matched} / ${data.summary.total} ทรัพย์`
          : ""}
      </summary>
      <div className="facebook-date-content">
        <p className="small">
          ตรวจจากรูปที่เก็บในคลัง ไม่ดึง Facebook ซ้ำ · {time(data?.checkedAt)}
        </p>
        {data && (
          <p className="small">
            ต้องตรวจเลขคดี {data.summary.needs_ocr_review} · ขาดโพสต์{" "}
            {data.summary.missing_posts} · รอประกาศ{" "}
            {data.summary.awaiting_announcement} · กำลังอ่าน{" "}
            {data.summary.processing} · อัลบั้มไม่ครบ{" "}
            {data.summary.incomplete_album}
          </p>
        )}
        <p className="small muted">
          ผลอ่านที่ไม่สอดคล้องกันจะถูกลองอ่านด้วยรูปแบบอื่นอัตโนมัติ
          หากยังไม่ชัดจะเก็บสถานะไว้ให้ตรวจ โดยไม่เดา E หรือตัวเลข
          ระบบตรวจรูปใหม่หลังซิงค์คลังเสมอ
        </p>
        <div className="case-review-controls">
          <label>
            สถานะ
            <select
              aria-label="สถานะผลตรวจเลขคดี"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="unresolved">ทั้งหมดที่ยังไม่พบ</option>
              {Object.entries(labels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            ค้นเลขคดีหรือลำดับ
            <input
              aria-label="ค้นเลขคดีในผลตรวจ"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <button disabled={loading} onClick={() => setRefresh((n) => n + 1)}>
            {loading ? (
              <LoaderCircle size={16} className="action-spinner" />
            ) : (
              <RefreshCw size={16} />
            )}{" "}
            {loading ? "กำลังตรวจ…" : "ตรวจจากคลังอีกครั้ง"}
          </button>
        </div>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <p className="small">{items.length} รายการ</p>
        <div className="case-review-list">
          {items.map((item) => (
            <article key={item.id}>
              <button
                disabled={Boolean(opening)}
                onClick={async () => {
                  setOpening(item.id);
                  try {
                    await onProperty(item.id);
                  } catch (error) {
                    setError((error as Error).message);
                  } finally {
                    setOpening(null);
                  }
                }}
              >
                {opening === item.id ? "กำลังเปิด…" : "เปิด"}
              </button>
              <div>
                <strong>{item.caseNumber || "ไม่มีเลขคดี"}</strong>
                {item.sourceOffice && (
                  <p className="small muted">
                    สำนักงานต้นทาง: {item.sourceOffice}
                  </p>
                )}
                {item.sourceNotice && (
                  <p className="small inline-error">{item.sourceNotice}</p>
                )}
                <p className="small">
                  ลำดับ {item.assetSequence} · {labels[item.status]} ·{" "}
                  {item.eligiblePhotos} รูปตรงวัน
                </p>
                {item.status === "needs_ocr_review" &&
                  item.unreadableRows > 0 && (
                    <p className="small muted">
                      รูปที่เกี่ยวข้องยังมีช่องเลขคดีอ่านไม่ชัด
                    </p>
                  )}
                {Boolean(item.failedPhotos) && (
                  <p className="small inline-error">
                    อ่านไฟล์ภาพไม่สำเร็จ {item.failedPhotos} รูป
                    ระบบเก็บคิวไว้ลองใหม่
                  </p>
                )}
                {item.otherDatePhotos.length > 0 && (
                  <p className="small muted">
                    พบเลขคดีในโพสต์วันอื่น
                    แต่ไม่นำมาใช้เพราะวันที่ในข้อความไม่ตรงนัดของทรัพย์นี้
                  </p>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
    </details>
  );
}
