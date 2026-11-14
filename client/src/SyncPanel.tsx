import { useState } from "react";
import { ChevronDown, Save, Search } from "lucide-react";
import type { Province, Settings } from "./catalog-types";
export function SyncPanel({
  provinces,
  initial,
  disabled,
  onSave,
}: {
  provinces: Province[];
  initial: Settings;
  disabled: boolean;
  onSave: (s: Settings) => Promise<void>;
}) {
  const [draft, setDraft] = useState(initial),
    [query, setQuery] = useState(""),
    [opened, setOpened] = useState<string[]>(["50"]),
    [saving, setSaving] = useState(false),
    [dirty, setDirty] = useState(false);
  const controlsDisabled = disabled || saving;
  const duplicatePolicy = draft.duplicatePolicy ?? "skip_unchanged";
  const patch = (p: Partial<Settings>) => {
    setDraft((d) => ({ ...d, ...p }));
    setDirty(true);
  };
  function scope(code: string, ids: string[]) {
    patch({
      scopes: [
        ...draft.scopes.filter((s) => s.provinceCode !== code),
        ...(ids.length ? [{ provinceCode: code, districtCodes: ids }] : []),
      ],
    });
  }
  const count = draft.scopes.reduce((n, s) => n + s.districtCodes.length, 0);
  return (
    <section className="sync-panel" aria-labelledby="sync-scope-title">
      <div className="section-head">
        <div>
          <span className="eyebrow">SYNC SCOPE</span>
          <h2 id="sync-scope-title">เลือกพื้นที่ที่ต้องการติดตาม</h2>
          <p>
            ซิงค์ทุกประเภท ราคา และขนาดพื้นที่ในอำเภอที่เลือก
            ข้ามแถวสีแดงตามเดิม
          </p>
        </div>
        <span className="count-tag">{count} อำเภอ</span>
      </div>
      <div className="sync-options">
        <label className="check">
          <input
            type="checkbox"
            checked={draft.enabled}
            disabled={controlsDisabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
          />
          ซิงค์อัตโนมัติขณะโปรแกรมเปิด (รวมค้นพิกัดที่ยังขาดทุกวัน)
        </label>
        <label>
          ความถี่
          <select
            value={draft.intervalHours}
            disabled={controlsDisabled}
            onChange={(e) => patch({ intervalHours: +e.target.value })}
          >
            <option value={1}>ทุก 1 ชั่วโมง</option>
            <option value={6}>ทุก 6 ชั่วโมง</option>
            <option value={24}>วันละครั้ง</option>
            <option value={168}>สัปดาห์ละครั้ง</option>
          </select>
        </label>
        <label>
          เมื่อพบรายการเดิม
          <select
            value={duplicatePolicy}
            disabled={controlsDisabled}
            aria-describedby="duplicate-policy-help"
            onChange={(e) =>
              patch({
                duplicatePolicy:
                  e.target.value === "refresh_all"
                    ? "refresh_all"
                    : "skip_unchanged",
              })
            }
          >
            <option value="skip_unchanged">
              ข้ามรายการเดิมที่ข้อมูลครบและไม่เปลี่ยน
            </option>
            <option value="refresh_all">
              ดึงรายละเอียดและภาพใหม่ทุกรายการ
            </option>
          </select>
          <small className="hint" id="duplicate-policy-help">
            {duplicatePolicy === "skip_unchanged"
              ? "ค่าเริ่มต้น ระบบอ่านหน้ารายการเพื่อเทียบข้อมูล แล้วดึงรายละเอียดและภาพเฉพาะรายการใหม่ รายการที่เปลี่ยน หรือหลักฐานที่ยังไม่ครบ"
              : "เปิดรายละเอียดและตรวจภาพอีกครั้ง รวมถึงรายการเดิมที่ข้อมูลครบแล้ว รอบซิงค์อาจใช้เวลานานขึ้น"}{" "}
            ทั้งสองแบบอัปเดตรายการเดิมในคลังและเก็บบุ๊กมาร์ก ดาว และคอมเมนต์ไว้
          </small>
        </label>
      </div>
      <div className="geo-toolbar">
        <label className="search-box">
          <Search size={17} />
          <input
            aria-label="ค้นหาจังหวัดหรืออำเภอ"
            placeholder="ค้นหาจังหวัดหรืออำเภอ"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button
          disabled={controlsDisabled}
          onClick={() =>
            patch({
              scopes: provinces.map((p) => ({
                provinceCode: p.code,
                districtCodes: p.districts.map((d) => d.code),
              })),
            })
          }
        >
          เลือกทุกจังหวัด
        </button>
        <button
          disabled={controlsDisabled}
          onClick={() => patch({ scopes: [] })}
        >
          ล้างการเลือก
        </button>
      </div>
      <div className="province-grid">
        {provinces
          .filter(
            (p) =>
              !query ||
              p.name.includes(query) ||
              p.districts.some((d) => d.name.includes(query)),
          )
          .map((p) => {
            const ids =
                draft.scopes.find((s) => s.provinceCode === p.code)
                  ?.districtCodes || [],
              all = ids.length === p.districts.length,
              open = opened.includes(p.code) || !!query;
            return (
              <div className="province" key={p.code}>
                <div className="province-heading">
                  <label className="check">
                    <input
                      type="checkbox"
                      aria-label={`เลือกทุกอำเภอ ${p.name}`}
                      checked={all}
                      ref={(el) => {
                        if (el) el.indeterminate = ids.length > 0 && !all;
                      }}
                      disabled={controlsDisabled}
                      onChange={() =>
                        scope(p.code, all ? [] : p.districts.map((d) => d.code))
                      }
                    />
                    <strong>{p.name}</strong>
                    <small>
                      {ids.length}/{p.districts.length}
                    </small>
                  </label>
                  <button
                    aria-label={`แสดงอำเภอ ${p.name}`}
                    aria-expanded={open}
                    onClick={() =>
                      setOpened((v) =>
                        v.includes(p.code)
                          ? v.filter((x) => x !== p.code)
                          : [...v, p.code],
                      )
                    }
                  >
                    <ChevronDown size={16} />
                  </button>
                </div>
                {open && (
                  <div className="district-grid">
                    {p.districts
                      .filter(
                        (d) =>
                          !query ||
                          p.name.includes(query) ||
                          d.name.includes(query),
                      )
                      .map((d) => (
                        <label className="check" key={d.code}>
                          <input
                            type="checkbox"
                            checked={ids.includes(d.code)}
                            disabled={controlsDisabled}
                            onChange={() =>
                              scope(
                                p.code,
                                ids.includes(d.code)
                                  ? ids.filter((x) => x !== d.code)
                                  : [...ids, d.code],
                              )
                            }
                          />
                          {d.name}
                          {p.districts.filter((x) => x.name === d.name).length >
                            1 && <small>({d.code})</small>}
                        </label>
                      ))}
                  </div>
                )}
              </div>
            );
          })}
      </div>
      <section
        className="retention-section"
        aria-labelledby="sync-retention-title"
      >
        <h2 id="sync-retention-title">การลบข้อมูลหมดอายุ</h2>
        <label>
          ข้อยกเว้นการลบข้อมูลหมดอายุ
          <select
            value={draft.retention}
            disabled={controlsDisabled}
            onChange={(e) => patch({ retention: e.target.value })}
          >
            <option value="manual">เก็บเฉพาะที่เลือกห้ามลบอัตโนมัติ</option>
            <option value="bookmarked">เก็บหากบุ๊กมาร์ก</option>
            <option value="engaged">เก็บหากมีบุ๊กมาร์ก ดาว หรือคอมเมนต์</option>
          </select>
        </label>
        <div className="info-note">
          ลบข้อมูลและรูปตั้งแต่วันถัดจากวันประมูลสุดท้ายครบ 1 เดือนปฏิทิน
          เก็บทรัพย์ที่เลือก “ห้ามลบอัตโนมัติ”
          และทรัพย์ที่ยังอ่านวันประมูลได้ไม่ครบไว้เสมอ
        </div>
      </section>
      <div className="save-bar">
        <span>
          {dirty ? "มีการตั้งค่าที่ยังไม่บันทึก" : "บันทึกการตั้งค่าแล้ว"} ·{" "}
          {draft.scopes.length} จังหวัด / {count} อำเภอ
        </span>
        <button
          className="primary"
          disabled={disabled || saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave(draft);
              setDirty(false);
            } catch {
              // Keep unsaved scope choices; the parent displays the error.
            } finally {
              setSaving(false);
            }
          }}
        >
          <Save size={16} />
          {saving
            ? "กำลังบันทึก"
            : count
              ? "บันทึกและเริ่มซิงค์"
              : "บันทึกการตั้งค่าซิงค์"}
        </button>
      </div>
    </section>
  );
}
