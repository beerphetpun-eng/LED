import { useState } from "react";
import { auctionDay, money } from "./catalog-api";
import type { Property } from "./catalog-types";

type Value = string | number | null;
type Column = {
  label: string;
  value: (p: Property) => Value;
  display?: (p: Property) => string;
};
const collator = new Intl.Collator("th", { numeric: true });
const columns: Column[] = [
  { label: "ลำดับ", value: (p) => p.assetSequence },
  { label: "ประเภททรัพย์", value: (p) => p.propertyType },
  { label: "จังหวัด", value: (p) => p.province },
  { label: "อำเภอ", value: (p) => p.district },
  { label: "ตำบล", value: (p) => p.subdistrict },
  { label: "เลขคดี", value: (p) => p.caseNumber },
  { label: "โฉนด", value: (p) => p.deed || null },
  {
    label: "เนื้อที่",
    value: (p) => p.areaSqWa,
    display: (p) => p.areaText || "—",
  },
  {
    label: "ราคารวม (บาท)",
    value: (p) => p.pricing.total,
    display: (p) => money(p.pricing.total),
  },
  {
    label: "จำนองติดไป",
    value: (p) => Number(p.pricing.carriesMortgage),
    display: (p) => (p.pricing.carriesMortgage ? "มี" : "—"),
  },
  {
    label: "วันประมูลแรก",
    value: (p) => auctionDay(p.auctionDates[0] || "") || null,
    display: (p) => p.auctionDates[0] || "—",
  },
  { label: "ดาว", value: (p) => p.user.stars },
  {
    label: "บุ๊กมาร์ก",
    value: (p) => Number(p.user.bookmarked),
    display: (p) => (p.user.bookmarked ? "บันทึกแล้ว" : "—"),
  },
  {
    label: "พิกัด",
    value: (p) =>
      p.parcels.some((v) => v.latitude !== null && v.longitude !== null)
        ? "พบพิกัด"
        : "รอพิกัด / ตรวจสอบ",
  },
  {
    label: "สถานะประมูล",
    value: (p) =>
      p.user.auctionStatus === "ended"
        ? "จบประมูลแล้ว"
        : p.user.auctionStatus === "auctioning"
          ? "อยู่ระหว่างประมูล"
          : "ยังไม่ระบุ",
  },
  { label: "ตรวจราคา", value: (p) => p.pricing.warning },
];

export function PropertyTable({
  items,
  onSelect,
}: {
  items: Property[];
  onSelect: (p: Property) => void;
}) {
  const [sort, setSort] = useState<{
    index: number;
    descending: boolean;
  } | null>(null);
  const rows = sort
    ? [...items].sort((a, b) => {
        const column = columns[sort.index];
        const x = column.value(a),
          y = column.value(b);
        if (x === null || y === null)
          return Number(x === null) - Number(y === null);
        const delta =
          typeof x === "number" && typeof y === "number"
            ? x - y
            : collator.compare(String(x), String(y));
        return sort.descending ? -delta : delta;
      })
    : items;
  return (
    <div
      className="property-table-scroll"
      tabIndex={0}
      aria-label="ตารางทรัพย์ เลื่อนแนวนอนเพื่อดูทุกคอลัมน์"
    >
      <table className="property-table" aria-label="รายการทรัพย์">
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th
                key={column.label}
                scope="col"
                aria-sort={
                  sort?.index === index
                    ? sort.descending
                      ? "descending"
                      : "ascending"
                    : undefined
                }
              >
                <button
                  onClick={() =>
                    setSort({
                      index,
                      descending:
                        sort?.index === index ? !sort.descending : false,
                    })
                  }
                >
                  {column.label}{" "}
                  <span aria-hidden="true">
                    {sort?.index === index
                      ? sort.descending
                        ? "↓"
                        : "↑"
                      : "↕"}
                  </span>
                </button>
              </th>
            ))}
            <th scope="col">รายละเอียด</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              {columns.map((column) => (
                <td key={column.label}>
                  {column.display
                    ? column.display(p)
                    : (column.value(p) ?? "—")}
                </td>
              ))}
              <td>
                <button
                  onClick={() => onSelect(p)}
                  aria-label={`ดูรายละเอียดทรัพย์ ${p.assetSequence} คดี ${p.caseNumber}`}
                >
                  เปิด
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
