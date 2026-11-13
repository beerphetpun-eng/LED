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
    <section className="sync-panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">SYNC SCOPE</span>
          <h2>เลือกพื้นที่ที่ต้องการติดตาม</h2>
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
            disabled={disabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
          />
          ซิงค์อัตโนมัติขณะโปรแกรมเปิด (รวมค้นพิกัดที่ยังขาดทุกวัน)
        </label>
        <label>
          ความถี่
          <select
            value={draft.intervalHours}
            disabled={disabled}
            onChange={(e) => patch({ intervalHours: +e.target.value })}
          >
            <option value={1}>ทุก 1 ชั่วโมง</option>
            <option value={6}>ทุก 6 ชั่วโมง</option>
            <option value={24}>วันละครั้ง</option>
            <option value={168}>สัปดาห์ละครั้ง</option>
          </select>
        </label>
        <label>
          ข้อยกเว้นการลบข้อมูลหมดอายุ
          <select
            value={draft.retention}
            disabled={disabled}
            onChange={(e) => patch({ retention: e.target.value })}
          >
            <option value="engaged">เก็บหากมีบุ๊กมาร์ก ดาว หรือคอมเมนต์</option>
            <option value="bookmarked">เก็บหากบุ๊กมาร์ก</option>
            <option value="manual">เก็บเฉพาะที่เลือกห้ามลบอัตโนมัติ</option>
          </select>
        </label>
      </div>
      <div className="info-note">
        ลบหลังวันประมูลสุดท้ายครบ 1 เดือนปฏิทิน รวมรูปทั้งหมด
        โดยเริ่มลบวันถัดจากวันครบกำหนด ทรัพย์ที่เลือก “ห้ามลบอัตโนมัติ”
        จะเก็บไว้เสมอ หากไม่มีวันประมูลที่อ่านได้ครบ ระบบจะไม่ลบ
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
          disabled={disabled}
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
        <button disabled={disabled} onClick={() => patch({ scopes: [] })}>
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
                      disabled={disabled}
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
                            disabled={disabled}
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
      <div className="save-bar">
        <span>
          {dirty ? "มีการตั้งค่าที่ยังไม่บันทึก" : "บันทึกขอบเขตปัจจุบันแล้ว"} ·{" "}
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
