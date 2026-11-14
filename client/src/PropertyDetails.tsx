import { useState } from "react";
import {
  Bookmark,
  Star,
  X,
  ExternalLink,
  Save,
  RefreshCw,
  Image as ImageIcon,
} from "lucide-react";
import type { Property, UserNotes } from "./catalog-types";
import { mapParcels, money, time, today, auctionDay } from "./catalog-api";
import { approximateLocation } from "./approximate-location";

function EvidenceStatus({ property }: { property: Property }) {
  const images = property.evidenceImages;
  if (!images?.photos)
    return (
      <small
        className={property.evidenceReady === false ? "inline-error" : "muted"}
      >
        {property.evidenceReady === false
          ? "ภาพประกาศโหลดไม่ครบ รอเก็บใหม่ในรอบซิงค์"
          : "ภาพเดิม · รอตรวจรูปถ่ายทรัพย์ในรอบซิงค์"}
      </small>
    );
  const { loaded, total } = images.photos;
  return (
    <small className={property.evidenceReady ? "muted" : "inline-error"}>
      {total === 0
        ? "ไม่พบรูปถ่ายทรัพย์ในหน้าต้นทาง"
        : `รูปถ่ายทรัพย์ที่โหลดได้ ${loaded}/${total} รูป`}
      {images.previousCaptureKept && " · แสดงภาพประกาศที่เก็บไว้ก่อนหน้า"}
      {!property.evidenceReady && " · ระบบจะตรวจใหม่ในรอบซิงค์"}
    </small>
  );
}
export function PropertyDetails({
  property: p,
  onClose,
  onSave,
  onFacebook,
  onRefreshPhotos,
  onImage,
}: {
  property: Property;
  onClose: () => void;
  onSave: (patch: Partial<UserNotes>) => Promise<void>;
  onFacebook: (days: number) => Promise<void>;
  onRefreshPhotos: () => Promise<{
    checked: number;
    requested: number;
    complete: boolean;
  }>;
  onImage: (url: string) => void;
}) {
  const [pendingPreferences, setPendingPreferences] = useState<Partial<
      Omit<UserNotes, "comment">
    > | null>(null),
    [preferenceMessage, setPreferenceMessage] = useState<{
      text: string;
      error: boolean;
    } | null>(null),
    [commentDraft, setCommentDraft] = useState<string | null>(null),
    [savingComment, setSavingComment] = useState(false),
    [commentError, setCommentError] = useState(""),
    [fbBusy, setFbBusy] = useState(false),
    [photoBusy, setPhotoBusy] = useState(false),
    [photoMessage, setPhotoMessage] = useState<{
      text: string;
      warning: boolean;
    } | null>(null),
    [days, setDays] = useState(7);
  const user = { ...p.user, ...pendingPreferences };
  const comment = commentDraft ?? p.user.comment;
  async function savePreferences(patch: Partial<Omit<UserNotes, "comment">>) {
    if (pendingPreferences) return;
    setPendingPreferences(patch);
    setPreferenceMessage(null);
    try {
      await onSave(patch);
      setPreferenceMessage({ text: "บันทึกแล้ว", error: false });
    } catch (e) {
      setPreferenceMessage({ text: (e as Error).message, error: true });
    } finally {
      setPendingPreferences(null);
    }
  }
  async function saveComment() {
    setSavingComment(true);
    setCommentError("");
    try {
      await onSave({ comment });
      setCommentDraft((draft) => (draft === comment ? null : draft));
    } catch (e) {
      setCommentError((e as Error).message);
    } finally {
      setSavingComment(false);
    }
  }
  const estimate = mapParcels(p).length ? null : approximateLocation(p);
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
        <div className="detail-overview">
          <div className="detail-title">
            <span className="pill">ลำดับ {p.assetSequence}</span>
            <h2>{p.propertyType}</h2>
            <p>
              {p.subdistrict} · {p.district} · {p.province}
            </p>
          </div>
          <div className="full-price">
            ฿ {money(p.pricing.total)}
            <small>
              {p.pricing.carriesMortgage
                ? "ราคารวมเต็ม · รวมจำนองติดไป"
                : "ราคาประเมินเต็มตามประกาศ"}
            </small>
          </div>
        </div>
        <div className="detail-columns">
          <section className="detail-column" aria-label="ข้อมูลทรัพย์และบันทึก">
            {p.pricing.carriesMortgage && (
              <div className="mortgage-breakdown">
                <div>
                  <span>ราคาประเมิน</span>
                  <strong>฿ {money(p.pricing.appraisal)}</strong>
                </div>
                <div>
                  <span>หนี้จำนองติดไป (ไม่ลด)</span>
                  <strong>+ ฿ {money(p.pricing.mortgageDebt)}</strong>
                </div>
                <details>
                  <summary>เงื่อนไขจำนองจากประกาศ</summary>
                  <p>{p.pricing.mortgageClause}</p>
                </details>
              </div>
            )}
            {p.pricing.warning && (
              <p role="alert" className="inline-error">
                {p.pricing.warning}
              </p>
            )}
            <div className="discounts">
              {p.pricing.options
                .filter((o) => o.discount > 0)
                .map(({ discount, appraisal, total }) => (
                  <div key={discount}>
                    <small>ลด {discount}%</small>
                    <strong>฿ {money(total)}</strong>
                    {p.pricing.carriesMortgage && (
                      <small>
                        {money(appraisal)} + {money(p.pricing.mortgageDebt)}
                      </small>
                    )}
                  </div>
                ))}
            </div>
            <p className="muted small">
              {p.pricing.carriesMortgage &&
                "ลดเฉพาะราคาประเมิน หนี้จำนองติดไปคงเดิมทุกนัด · "}
              ราคาลดเป็นการคำนวณประกอบการพิจารณา
              ไม่ใช่ราคาเริ่มประมูลที่ยืนยันโดยต้นทาง
            </p>
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
            <section className="personal">
              <h3>บันทึกของคุณ</h3>
              <fieldset
                className="property-preferences"
                aria-label="บันทึกอัตโนมัติ"
                disabled={!!pendingPreferences}
              >
                <button
                  className={user.bookmarked ? "bookmark active" : "bookmark"}
                  aria-pressed={user.bookmarked}
                  onClick={() =>
                    void savePreferences({ bookmarked: !user.bookmarked })
                  }
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
                    aria-pressed={user.stars === 0}
                    onClick={() => void savePreferences({ stars: 0 })}
                  >
                    0
                  </button>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      aria-label={`ให้ ${n} ดาว`}
                      aria-pressed={user.stars === n}
                      onClick={() => void savePreferences({ stars: n })}
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
                    onChange={(e) =>
                      void savePreferences({ auctionStatus: e.target.value })
                    }
                  >
                    <option value="">ยังไม่ระบุ</option>
                    <option value="auctioning">ยังอยู่ในสถานะประมูล</option>
                    <option value="ended">จบการประมูลแล้ว</option>
                  </select>
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={user.protected}
                    onChange={(e) =>
                      void savePreferences({ protected: e.target.checked })
                    }
                  />
                  ห้ามลบอัตโนมัติ
                </label>
              </fieldset>
              <small
                role="status"
                className={preferenceMessage?.error ? "inline-error" : "muted"}
              >
                {pendingPreferences
                  ? "กำลังบันทึก…"
                  : preferenceMessage?.text || "บันทึกอัตโนมัติเมื่อเปลี่ยน"}
              </small>
            </section>
            <section className="property-comment" aria-label="คอมเมนต์">
              <label>
                คอมเมนต์
                <textarea
                  value={comment}
                  maxLength={10000}
                  rows={3}
                  placeholder="จดรายละเอียดที่สนใจ…"
                  onChange={(e) => {
                    setCommentDraft(e.target.value);
                    setCommentError("");
                  }}
                />
              </label>
              {commentError && (
                <small role="alert" className="inline-error">
                  {commentError}
                </small>
              )}
              <button
                className="primary"
                disabled={comment === p.user.comment || savingComment}
                onClick={() => void saveComment()}
              >
                <Save size={15} />
                {savingComment ? "กำลังบันทึก…" : "บันทึกคอมเมนต์"}
              </button>
            </section>
          </section>
          <section
            className="detail-column detail-evidence"
            aria-label="ภาพและหลักฐาน"
          >
            <div className="detail-section-heading">
              <h3>ภาพประกาศกรมบังคับคดี</h3>
              <button
                disabled={photoBusy}
                onClick={async () => {
                  setPhotoBusy(true);
                  setPhotoMessage(null);
                  try {
                    const result = await onRefreshPhotos();
                    setPhotoMessage({
                      text: result.complete
                        ? "รีเฟรชแล้ว รูปประกาศครบ"
                        : `ตรวจได้ ${result.checked}/${result.requested} รายการย่อย รูปจากต้นทางยังไม่ครบ`,
                      warning: !result.complete,
                    });
                  } catch (e) {
                    setPhotoMessage({
                      text: (e as Error).message,
                      warning: true,
                    });
                  } finally {
                    setPhotoBusy(false);
                  }
                }}
              >
                <RefreshCw size={15} />{" "}
                {photoBusy ? "กำลังดึงรูปใหม่…" : "รีเฟรชรูปประกาศ"}
              </button>
            </div>
            {photoMessage && (
              <p
                role="status"
                className={photoMessage.warning ? "inline-error" : "small"}
              >
                {photoMessage.text}
              </p>
            )}
            {p.error && <p className="inline-error">{p.error}</p>}
            {p.screenshotUrl && (
              <button
                className="evidence"
                onClick={() => onImage(p.screenshotUrl)}
              >
                <img src={p.screenshotUrl} alt="ภาพประกาศกรมบังคับคดี" />
                <span>
                  <ImageIcon size={15} />
                  ขยายภาพประกาศต้นฉบับ
                </span>
              </button>
            )}
            {p.screenshotUrl && (
              <p className="small">
                <EvidenceStatus property={p.assetComponents?.[0] || p} />
              </p>
            )}
            {(p.assetComponents?.length || 0) > 1 && (
              <section>
                <h3>ทรัพย์ย่อยในประกาศขายรวม ({p.assetComponents!.length})</h3>
                <p className="small muted">
                  ราคาเต็มด้านบนเป็นราคาของประกาศขายรวม
                  ตรวจเงื่อนไขจากภาพต้นฉบับของแต่ละรายการ
                </p>
                <div className="evidence-pair">
                  {p.assetComponents!.map((c) => (
                    <button
                      key={c.componentKey}
                      onClick={() => onImage(c.screenshotUrl)}
                    >
                      <img
                        loading="lazy"
                        src={c.screenshotUrl}
                        alt={`ประกาศทรัพย์ย่อย เลขที่ ${c.address || "ไม่ระบุ"}`}
                      />
                      <span>
                        เลขที่ {c.address || "ไม่ระบุ"} · {c.areaText}
                        <EvidenceStatus property={c} />
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}
            <h3>หลักฐาน LandsMaps</h3>
            {estimate && (
              <p className="info-note">
                พิกัดโดยประมาณอิงพื้นที่ {estimate.area}{" "}
                ตำแหน่งแปลงยังไม่ได้รับการยืนยัน
              </p>
            )}
            {p.parcels.length === 0 && (
              <p className="muted">ยังไม่มีพิกัดที่ยืนยันได้</p>
            )}
            {p.parcels.map((v) => (
              <div className="parcel" key={v.deed}>
                <strong>โฉนด {v.deed}</strong>
                <p>
                  {v.latitude !== null && v.longitude !== null ? (
                    <a
                      className="text-link"
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${v.latitude},${v.longitude}`)}`}
                      target="_blank"
                      rel="noreferrer"
                      title="เปิดพิกัดนี้ใน Google Maps"
                    >
                      {v.latitude}, {v.longitude} <ExternalLink size={13} />
                    </a>
                  ) : (
                    "ยังไม่พบพิกัด"
                  )}
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
                  className={
                    v.backgroundReady === false ? "inline-error" : "muted"
                  }
                >
                  {v.note}
                </small>
                {v.lookupWarning && (
                  <p className="inline-error">
                    ค้นซ้ำล่าสุด: {v.lookupWarning} ·
                    ยังใช้พิกัดที่ยืนยันไว้เดิม
                  </p>
                )}
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
                    // The notification menu reports the failure.
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
                          <button
                            key={im.photoId}
                            onClick={() => onImage(im.url)}
                          >
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
          </section>
        </div>
      </div>
    </aside>
  );
}
