export async function api<T>(
  url: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const r = await fetch("/api" + url, {
    method,
    headers: { "Content-Type": "application/json", "X-Land-Radar": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "เชื่อมต่อไม่สำเร็จ");
  return data;
}
export const money = (v: number | null) =>
  v === null
    ? "ไม่ระบุ"
    : new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 }).format(v);
export const time = (v?: string) =>
  v
    ? new Date(v).toLocaleString("th-TH", {
        timeZone: "Asia/Bangkok",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
export const today = () =>
  new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
export function auctionDay(s: string) {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return "";
  return `${+m[3] > 2400 ? +m[3] - 543 : +m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}
