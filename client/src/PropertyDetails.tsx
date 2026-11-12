import { useState } from "react";
import {
  Bookmark,
  Star,
  X,
  ExternalLink,
  Save,
  Image as ImageIcon,
} from "lucide-react";
import type { Property, UserNotes } from "./catalog-types";
import { money, time, today, auctionDay } from "./catalog-api";
export function PropertyDetails({
  property: p,
  onClose,
  onSave,
  onFacebook,
  onImage,
}: {
  property: Property;
  onClose: () => void;
  onSave: (u: UserNotes) => Promise<void>;
  onFacebook: (days: number) => Promise<void>;
  onImage: (url: string) => void;
}) {
  const [user, setUser] = useState(p.user),
    [saving, setSaving] = useState(false),
    [fbBusy, setFbBusy] = useState(false),
    [days, setDays] = useState(7),
    [dirty, setDirty] = useState(false);
  const edit = (u: Partial<UserNotes>) => {
    setUser((s) => ({ ...s, ...u }));
    setDirty(true);
  };
  const next = p.auctionDates
    .map(auctionDay)
    .filter((d) => d >= today())
    .sort()[0];
  return (
    <aside className="details" aria-label="รายละเอียดทรัพย์">
      <header>
        <span className="eyebrow">PROPERTY DETAILS</span>
        <button aria-label="ปิดรายละเอียด" onClick={onClose}>
          <X size={21} />
        </button>
      </header>
      <div className="details-scroll">
        <div className="detail-title">
          <span className="pill">ลำดับ {p.assetSequence}</span>
          <h2>{p.propertyType}</h2>
          <p>
            {p.subdistrict} · {p.district} · {p.province}
          </p>
        </div>
        <div className="full-price">
          ฿ {money(p.price)}
          <small>ราคาประเมินเต็มตามประกาศ</small>
        </div>
        <div className="discounts">
          {[10, 20, 30].map((discount) => (
            <div key={discount}>
              <small>ลด {discount}%</small>
              <strong>
                ฿{" "}
                {money(
                  p.price === null
                    ? null
                    : Math.round(p.price * (100 - discount)) / 100,
                )}
              </strong>
            </div>
          ))}
        </div>
        <p className="muted small">
          ราคาลดเป็นการคำนวณประกอบการพิจารณา
          ไม่ใช่ราคาเริ่มประมูลที่ยืนยันโดยต้นทาง
        </p>
        <section className="personal">
          <h3>บันทึกของคุณ</h3>
          <button
            className={user.bookmarked ? "bookmark active" : "bookmark"}
            aria-pressed={user.bookmarked}
            onClick={() => edit({ bookmarked: !user.bookmarked })}
          >
            <Bookmark
              size={17}
              fill={user.bookmarked ? "currentColor" : "none"}
            />
            {user.bookmarked ? "บุ๊กมาร์กแล้ว" : "บุ๊กมาร์กทรัพย์"}
          </button>
          <div className="stars" aria-label="ให้คะแนนทรัพย์">
            <button
              className={user.stars === 0 ? "chosen" : ""}
              aria-label="ให้ 0 ดาว"
              onClick={() => edit({ stars: 0 })}
            >
              0
            </button>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                aria-label={`ให้ ${n} ดาว`}
                aria-pressed={user.stars === n}
                onClick={() => edit({ stars: n })}
              >
                <Star
                  size={23}
                  fill={user.stars >= n ? "currentColor" : "none"}
                />
              </button>
            ))}
            <small>{user.stars}/5</small>
          </div>
          <label>
            สถานะประมูลที่คุณระบุ
            <select
              value={user.auctionStatus}
              onChange={(e) => edit({ auctionStatus: e.target.value })}
            >
              <option value="">ยังไม่ระบุ</option>
              <option value="auctioning">ยังอยู่ในสถานะประมูล</option>
              <option value="ended">จบการประมูลแล้ว</option>
            </select>
          </label>
          <label>
            คอมเมนต์
            <textarea
              value={user.comment}
              maxLength={10000}
              rows={3}
              placeholder="จดรายละเอียดที่สนใจ…"
              onChange={(e) => edit({ comment: e.target.value })}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={user.protected}
              onChange={(e) => edit({ protected: e.target.checked })}
            />
            ห้ามลบอัตโนมัติ
          </label>
          <button
            className="primary"
            disabled={!dirty || saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(user);
                setDirty(false);
              } catch {
                // The shared error banner reports the failure; keep the draft.
              } finally {
                setSaving(false);
              }
            }}
          >
            <Save size={15} />
            {saving
              ? "กำลังบันทึก"
              : dirty
                ? "บันทึกการเปลี่ยนแปลง"
                : "บันทึกแล้ว"}
          </button>
        </section>
        <h3>วันประมูลตามประกาศ</h3>
        <div className="auction-dates">
          {p.auctionDates.map((d) => (
            <span
              key={d}
              className={
                auctionDay(d) < today()
                  ? "past"
                  : auctionDay(d) === next
                    ? "next"
                    : "future"
              }
            >
              {d}
              {auctionDay(d) === next && <small>นัดถัดไป</small>}
            </span>
          ))}
          {!p.auctionDates.length && (
            <span className="muted">ยังอ่านวันที่ไม่ได้</span>
          )}
        </div>
        <dl className="facts">
          <dt>เลขคดีแดง</dt>
          <dd>{p.caseNumber || "ไม่พบ"}</dd>
          <dt>ทรัพย์ลำดับที่</dt>
          <dd>{p.assetSequence}</dd>
          <dt>ชุดการขาย</dt>
          <dd>{p.saleLot}</dd>
          <dt>โจทก์</dt>
          <dd>{p.plaintiff || "ไม่พบ"}</dd>
          <dt>เลขโฉนด / เอกสารสิทธิ</dt>
          <dd>{p.landDocument || p.deed || "ไม่พบ"}</dd>
          <dt>เนื้อที่</dt>
          <dd>{p.areaText}</dd>
          <dt>ซิงค์ครั้งแรก</dt>
          <dd>{time(p.firstSeen)}</dd>
          <dt>ซิงค์ล่าสุด</dt>
          <dd>
            {time(p.lastSeen)} · {p.syncCount} รอบ
          </dd>
        </dl>
        {p.error && <p className="inline-error">{p.error}</p>}
        {p.screenshotUrl && (
          <button className="evidence" onClick={() => onImage(p.screenshotUrl)}>
            <img src={p.screenshotUrl} alt="ภาพประกาศกรมบังคับคดี" />
            <span>
              <ImageIcon size={15} />
              ขยายภาพประกาศต้นฉบับ
            </span>
          </button>
        )}
        {p.screenshotUrl && (
          <p className="small muted">
            {p.evidenceReady
              ? `ตรวจรูปในหน้าประกาศก่อนแคปแล้ว ${p.evidenceImages?.loaded ?? ""}/${p.evidenceImages?.total ?? ""} รูป`
              : p.evidenceReady === false
                ? "ภาพประกาศยังโหลดไม่ครบ รอเก็บใหม่ในการซิงค์ถัดไป"
                : "ภาพเดิม รอตรวจสอบและเก็บใหม่ในการซิงค์ถัดไป"}
          </p>
        )}
        <h3>หลักฐาน LandsMaps</h3>
        {p.parcels.length === 0 && (
          <p className="muted">ยังไม่มีพิกัดที่ยืนยันได้</p>
        )}
        {p.parcels.map((v) => (
          <div className="parcel" key={v.deed}>
            <strong>โฉนด {v.deed}</strong>
            <p>
              {v.latitude !== null
                ? `${v.latitude}, ${v.longitude}`
                : "ยังไม่พบพิกัด"}
            </p>
            <div className="evidence-pair">
              {[
                [v.evidenceUrl, "ภาพพร้อมข้อมูลแปลง"],
                [v.mapEvidenceUrl, "ภาพพื้นหลังหลังปิดหน้าต่าง"],
              ].map(([url, label]) =>
                url ? (
                  <button key={url} onClick={() => onImage(url)}>
                    <img src={url} alt={label} />
                    <span>{label}</span>
                  </button>
                ) : null,
              )}
            </div>
            <small
              className={v.backgroundReady === false ? "inline-error" : "muted"}
            >
              {v.note}
            </small>
          </div>
        ))}
        <section className="facebook">
          <h3>ประกาศและผลการขายจาก Facebook</h3>
          <p className="muted small">
            ค้นเพจสำนักงานบังคับคดีเชียงใหม่ด้วยวันประมูลและคำว่า
            “ขายทอดตลาดทรัพย์” เก็บรูปเต็มสำหรับตรวจเลขคดีและลำดับ
          </p>
          <label>
            ช่วงวันก่อน / หลังวันประมูล
            <select value={days} onChange={(e) => setDays(+e.target.value)}>
              {[0, 3, 7, 14].map((d) => (
                <option key={d} value={d}>
                  {d === 0 ? "เฉพาะวันตรงกัน" : `ก่อน / หลัง ${d} วัน`}
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary"
            disabled={fbBusy}
            onClick={async () => {
              setFbBusy(true);
              try {
                await onFacebook(days);
              } catch {
                // The shared error banner reports the failure.
              } finally {
                setFbBusy(false);
              }
            }}
          >
            {fbBusy ? "กำลังค้นโพสต์และรูป…" : "ดึงข้อมูลจาก Facebook"}
          </button>
          <a
            className="text-link"
            href="https://web.facebook.com/ledcm2"
            target="_blank"
            rel="noreferrer"
          >
            เปิดเพจต้นฉบับ <ExternalLink size={13} />
          </a>
          {p.facebook?.posts && (
            <>
              <p className="small muted">
                ตรวจเมื่อ {time(p.facebook.checkedAt)} · {p.facebook.note}
              </p>
              {!p.facebook.posts.length && (
                <p>ไม่พบโพสต์ที่ตรงในช่วงที่ตรวจอ่านได้</p>
              )}
              {p.facebook.posts.map((post) => (
                <article className="facebook-post" key={post.url}>
                  <a href={post.url} target="_blank" rel="noreferrer">
                    {post.match.days === 0
                      ? "วันตรงกัน"
                      : `วันที่ห่าง ${post.match.days} วัน`}{" "}
                    · {post.match.date} <ExternalLink size={13} />
                  </a>
                  <p className="small">
                    ยังไม่ได้ยืนยันแถวที่ตรงกับคดี {p.caseNumber}
                  </p>
                  <details>
                    <summary>อ่านข้อความโพสต์</summary>
                    <p>{post.text}</p>
                  </details>
                  <div className="facebook-images">
                    {post.images.map((im) => (
                      <button key={im.photoId} onClick={() => onImage(im.url)}>
                        <img
                          loading="lazy"
                          src={im.url}
                          alt="ตารางประกาศขายทอดตลาดฉบับเต็ม"
                        />
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </>
          )}
        </section>
      </div>
    </aside>
  );
}
