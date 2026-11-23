import { useEffect, useState } from "react";
import { ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";
import { api, time } from "./catalog-api";
import { FacebookCaseReview } from "./FacebookCaseReview";
import type {
  FacebookLibraryStatus,
  FacebookLibraryData,
} from "./catalog-types";

const day = (date: string | null) =>
  date
    ? new Intl.DateTimeFormat("th-TH", {
        dateStyle: "long",
        timeZone: "Asia/Bangkok",
      }).format(new Date(date + "T12:00:00+07:00"))
    : "ไม่ทราบวันที่";

export function FacebookLibrary({
  status,
  onRefresh,
  onImage,
  onProperty,
}: {
  status: FacebookLibraryStatus;
  onRefresh: (date?: string) => Promise<void>;
  onImage: (url: string) => void;
  onProperty: (id: string) => Promise<void>;
}) {
  const [data, setData] = useState<FacebookLibraryData | null>(null);
  const [filter, setFilter] = useState("saved");
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    let disposed = false;
    let loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const value = await api<FacebookLibraryData>("/facebook/library");
        if (!disposed) {
          setData(value);
          setError("");
        }
      } catch (error) {
        if (!disposed) setError((error as Error).message);
      } finally {
        loading = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);
  const running = starting || status.running || Boolean(data?.running);
  const refresh = async (date?: string) => {
    if (running) return;
    setStarting(true);
    setError("");
    try {
      await onRefresh(date);
      setData(await api<FacebookLibraryData>("/facebook/library"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  };
  const groups =
    data?.groups.filter((group) =>
      filter === "missing"
        ? group.properties > 0 &&
          !group.available &&
          !group.awaitingAnnouncement
        : filter === "saved"
          ? group.posts.length > 0
          : true,
    ) || [];
  return (
    <section
      className="facebook-library"
      aria-labelledby="facebook-library-title"
    >
      <div className="section-head">
        <div>
          <h2 id="facebook-library-title">คลัง Facebook ตามวันประมูล</h2>
          <p>ใช้วันที่ในข้อความโพสต์ รูปในคลังใช้ร่วมกับทุกทรัพย์</p>
        </div>
        <button
          className="primary"
          disabled={running}
          aria-busy={running}
          onClick={() => void refresh()}
        >
          {running ? (
            <LoaderCircle size={16} className="action-spinner" />
          ) : (
            <RefreshCw size={16} />
          )}
          {running ? "กำลังดึงข้อมูล Facebook…" : "ดึงข้อมูล Facebook"}
        </button>
      </div>
      <p className="small">
        {status.photos} รูป · ครบ {status.complete} อัลบั้ม · ยังไม่ครบ{" "}
        {status.partial} อัลบั้ม
        {" · "}ตรวจล่าสุด {time(status.checkedAt)}
      </p>
      {status.progress && (
        <p role="status">
          {status.progress.message}{" "}
          {status.progress.targetDate && day(status.progress.targetDate)}
        </p>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {status.warnings.map((warning) => (
        <p className="small inline-error" key={warning}>
          {warning}
        </p>
      ))}
      <FacebookCaseReview revision={status.checkedAt} onProperty={onProperty} />
      <label className="facebook-library-filter">
        แสดงวันที่
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">ทั้งหมด</option>
          <option value="saved">มีโพสต์ในคลัง</option>
          <option value="missing">วันประมูลที่ยังขาดข้อมูล</option>
        </select>
      </label>
      {!data && <p role="status">กำลังโหลดคลัง Facebook…</p>}
      {data && !groups.length && <p>ไม่พบวันที่ตรงกับตัวเลือก</p>}
      {groups.map((group) => (
        <details className="facebook-date-group" key={group.date || "unknown"}>
          <summary>
            <strong>
              {group.date ? day(group.date) : "โพสต์ที่ยังอ่านวันประมูลไม่ได้"}
            </strong>
            <span>
              {group.posts.length} โพสต์ · {group.properties} ทรัพย์
            </span>
            <span className={group.available ? "facebook-available" : "muted"}>
              {group.available
                ? "มีข้อมูลใช้กับทรัพย์"
                : group.awaitingAnnouncement
                  ? "รอประกาศก่อนประมูล"
                  : "ยังไม่มีข้อมูลใช้กับทรัพย์"}
            </span>
          </summary>
          <div className="facebook-date-content">
            {group.checkedAt && (
              <p className="small muted">ค้นล่าสุด {time(group.checkedAt)}</p>
            )}
            {group.date && group.properties > 0 && (
              <button
                disabled={running}
                onClick={() => void refresh(group.date!)}
              >
                {running ? (
                  <LoaderCircle size={15} className="action-spinner" />
                ) : (
                  <RefreshCw size={15} />
                )}
                ค้นหาและดึงรูปวันที่นี้
              </button>
            )}
            {!group.posts.length && (
              <p className="muted">ยังไม่พบโพสต์ที่ระบุวันประมูลนี้ในข้อความ</p>
            )}
            {group.posts.map((post) => (
              <article
                className="facebook-post"
                key={post.albumKey || post.url}
              >
                <a href={post.url} target="_blank" rel="noreferrer">
                  {post.kind === "result"
                    ? "ผลประมูล"
                    : post.kind === "announcement"
                      ? "ประกาศก่อนประมูล"
                      : "โพสต์"}
                  {" · "}เผยแพร่ {day(post.publishedOn)}{" "}
                  <ExternalLink size={13} />
                </a>
                <p className="small">
                  เก็บแล้ว {post.images.length}{" "}
                  {post.expectedPhotos ? `จาก ${post.expectedPhotos}` : ""} รูป
                  {" · "}
                  {post.complete
                    ? "รูปครบตามจำนวนที่ทราบ"
                    : "รูปยังไม่ครบหรือยังยืนยันจำนวนไม่ได้"}
                  {" · "}
                  {post.eligible ? "ใช้กับทรัพย์" : "เก็บเป็นประวัติ"}
                </p>
                <details>
                  <summary>อ่านข้อความโพสต์</summary>
                  <p>{post.text}</p>
                </details>
                <div className="facebook-library-images">
                  {post.images.map((image) => (
                    <button
                      key={image.photoId}
                      onClick={() => onImage(image.url)}
                    >
                      <img
                        loading="lazy"
                        src={image.url}
                        alt={`ตารางขายทอดตลาด ${day(group.date)}`}
                      />
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </details>
      ))}
    </section>
  );
}
