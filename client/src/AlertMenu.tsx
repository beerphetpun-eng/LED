import { Bell, X } from "lucide-react";
import { useRef, useState } from "react";
import type { SyncAlert } from "./catalog-types";
import { time } from "./catalog-api";

export function AlertMenu({
  alerts,
  error,
  onDismiss,
  onClearError,
}: {
  alerts: SyncAlert[];
  error: string;
  onDismiss: (id: string) => void;
  onClearError: () => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const showError =
    !!error && !alerts.some((a) => a.message === error && !a.recoveredAt);
  const count = alerts.filter((a) => !a.recoveredAt).length + Number(showError);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div
      className="alert-menu"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (open && e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={trigger}
        className={open ? "active" : ""}
        aria-label={`แจ้งเตือน ${count} รายการ`}
        aria-expanded={open}
        aria-controls="alert-panel"
        onClick={() => setOpen(!open)}
      >
        <Bell size={16} /> แจ้งเตือน{" "}
        <span className="alert-count" aria-live="polite">
          {count}
        </span>
      </button>
      {open && (
        <section
          id="alert-panel"
          className="alert-panel"
          aria-label="ข้อผิดพลาดและรายการที่ต้องตรวจสอบ"
        >
          <header>
            <strong>ข้อผิดพลาด / รายการที่ต้องตรวจสอบ</strong>
            <button aria-label="ปิดเมนูแจ้งเตือน" onClick={close}>
              <X size={16} />
            </button>
          </header>
          <div className="alert-rows">
            {showError && (
              <div>
                <p>{error}</p>
                <button onClick={onClearError}>รับทราบ</button>
              </div>
            )}
            {alerts.map((a) => (
              <div key={a.id}>
                <div>
                  <p>{a.message}</p>
                  <small>
                    {a.recoveredAt
                      ? "แก้ไขแล้ว"
                      : a.retryable
                        ? "ลองใหม่อัตโนมัติในรอบซิงค์"
                        : "รอตรวจสอบ"}
                    {a.retryCount !== null
                      ? ` · ลองใหม่ ${a.retryCount} ครั้ง`
                      : " · ยังไม่มีประวัติการลองใหม่"}
                    {a.checkedAt && ` · ตรวจล่าสุด ${time(a.checkedAt)}`}
                  </small>
                </div>
                <button onClick={() => onDismiss(a.id)}>รับทราบ</button>
              </div>
            ))}
            {!alerts.length && !showError && (
              <p className="muted">ไม่มีรายการแจ้งเตือน</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
