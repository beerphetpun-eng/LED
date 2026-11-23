import { useState } from "react";
import { MapPin, RefreshCw, Save } from "lucide-react";
import { time } from "./catalog-api";
import type { SyncResponse } from "./catalog-types";

export function GeocodingPanel({
  sync,
  busy,
  hasProperties,
  onStart,
  onCancel,
}: {
  sync: SyncResponse;
  busy: boolean;
  hasProperties: boolean;
  onStart: () => void;
  onCancel: () => void;
}) {
  const runtime = sync.runtime;
  const geocoding = runtime.running && runtime.status === "geocoding";
  const cooling = Boolean(
    runtime.geoRetryAt && Date.parse(runtime.geoRetryAt) > Date.now(),
  );
  return (
    <section className="sync-panel" aria-labelledby="geocoding-title">
      <h2 id="geocoding-title">
        <MapPin size={22} /> ค้นพิกัด LandsMaps
      </h2>
      <p>ค้นโฉนดที่ยังขาดพิกัด และเก็บภาพหลักฐานของแต่ละแปลง</p>
      <dl className="sync-operation-stats">
        <div>
          <dt>{geocoding ? "รอบที่กำลังทำงาน" : "ความคืบหน้ารอบล่าสุด"}</dt>
          <dd>
            {runtime.geoDone || 0} / {runtime.geoTotal || 0} ประกาศ
          </dd>
        </div>
        <div>
          <dt>ค้นอัตโนมัติ</dt>
          <dd>{sync.settings.enabled ? "ตรวจทุกวัน" : "ปิดอยู่"}</dd>
        </div>
        <div>
          <dt>รอบค้นพิกัดถัดไป</dt>
          <dd>
            {time(runtime.geoRetryAt || runtime.nextGeoRunAt || undefined)}
          </dd>
        </div>
      </dl>
      {(cooling || runtime.quotaMessage) && (
        <p role="status" className="info-note">
          {!cooling && "ข้อจำกัดที่พบล่าสุด: "}
          {runtime.quotaMessage || "กำลังรอโควตาการค้นหาจาก LandsMaps"}
          {runtime.geoRetryAt ? ` · ลองใหม่ ${time(runtime.geoRetryAt)}` : ""}
        </p>
      )}
      {geocoding && <p role="status">{runtime.message}</p>}
      <div className="sync-actions">
        <button
          className="primary"
          disabled={busy || runtime.running || cooling || !hasProperties}
          onClick={onStart}
        >
          <RefreshCw size={16} /> ค้นพิกัดที่ยังขาด
        </button>
        {geocoding && <button onClick={onCancel}>หยุดค้นพิกัด</button>}
      </div>
      <p className="small muted">
        เมื่อแหล่งข้อมูลจำกัดจำนวนการค้นหา
        ระบบจะพักคิวและทำต่อเมื่อถึงเวลาลองใหม่
        เปิดซิงค์อัตโนมัติได้ที่แท็บตั้งค่าการซิงค์
      </p>
    </section>
  );
}

export function RetentionPanel({
  sync,
  onSave,
}: {
  sync: SyncResponse;
  onSave: (retention: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const retention = draft ?? sync.settings.retention;
  return (
    <section className="sync-panel" aria-labelledby="sync-retention-title">
      <h2 id="sync-retention-title">การลบข้อมูลหมดอายุ</h2>
      <p>ลบข้อมูลและรูปตั้งแต่วันถัดจากวันประมูลสุดท้ายครบ 1 เดือนปฏิทิน</p>
      <label>
        ข้อยกเว้นการลบข้อมูลหมดอายุ
        <select
          value={retention}
          disabled={saving || sync.runtime.running}
          onChange={(e) => {
            setDraft(e.target.value);
            setMessage("");
          }}
        >
          <option value="manual">เก็บเฉพาะที่เลือกห้ามลบอัตโนมัติ</option>
          <option value="bookmarked">เก็บหากบุ๊กมาร์ก</option>
          <option value="engaged">เก็บหากมีบุ๊กมาร์ก ดาว หรือคอมเมนต์</option>
        </select>
      </label>
      <div className="info-note">
        ทรัพย์ที่เลือก “ห้ามลบอัตโนมัติ”
        และทรัพย์ที่ยังอ่านวันประมูลได้ไม่ครบจะถูกเก็บไว้เสมอ
      </div>
      {sync.lastCleanup && (
        <p>
          ล้างข้อมูลล่าสุด {time(sync.lastCleanup.at)} ·{" "}
          {sync.lastCleanup.deleted} รายการ
        </p>
      )}
      <button
        className="primary"
        disabled={
          saving ||
          sync.runtime.running ||
          retention === sync.settings.retention
        }
        onClick={async () => {
          setSaving(true);
          setMessage("");
          try {
            await onSave(retention);
            setDraft(null);
            setMessage("บันทึกการตั้งค่าลบแล้ว");
          } catch {
            setMessage("บันทึกไม่สำเร็จ กรุณาตรวจการแจ้งเตือน");
          } finally {
            setSaving(false);
          }
        }}
      >
        <Save size={16} /> {saving ? "กำลังบันทึก…" : "บันทึกการตั้งค่าลบ"}
      </button>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
