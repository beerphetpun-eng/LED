import { useState, type ReactNode } from "react";
import { Star } from "lucide-react";
import { auctionDay, money } from "./catalog-api";
import { mapLocationLabel } from "./approximate-location";
import type { Property } from "./catalog-types";

type Value = string | number | null;
type Column = {
  label: string;
  value: (p: Property) => Value;
  display?: (p: Property) => ReactNode;
  truncate?: boolean;
};
const collator = new Intl.Collator("th", { numeric: true });
const columns: Column[] = [
  { label: "ลำดับ", value: (p) => p.assetSequence },
  { label: "ประเภททรัพย์", value: (p) => p.propertyType, truncate: true },
  { label: "จังหวัด", value: (p) => p.province },
  { label: "อำเภอ", value: (p) => p.district },
  { label: "ตำบล", value: (p) => p.subdistrict },
  { label: "เลขคดี", value: (p) => p.caseNumber },
  { label: "โฉนด", value: (p) => p.deed || null, truncate: true },
  {
    label: "เนื้อที่",
    value: (p) => p.areaSqWa,
    display: (p) => p.areaText || "—",
    truncate: true,
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
  {
    label: "ดาว",
    value: (p) => p.user.stars,
    display: (p) => (
      <span className="table-stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <Star
            key={n}
            size={13}
            aria-hidden="true"
            fill={n <= p.user.stars ? "currentColor" : "none"}
          />
        ))}
        <span>{p.user.stars}/5</span>
      </span>
    ),
  },
  {
    label: "บุ๊กมาร์ก",
    value: (p) => Number(p.user.bookmarked),
    display: (p) => (p.user.bookmarked ? "บันทึกแล้ว" : "—"),
  },
  {
    label: "พิกัด",
    value: mapLocationLabel,
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
  { label: "ตรวจราคา", value: (p) => p.pricing.warning, truncate: true },
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
            <th className="table-open" scope="col">
              เปิด
            </th>
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
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td className="table-open">
                <button
                  onClick={() => onSelect(p)}
                  aria-label={`ดูรายละเอียดทรัพย์ ${p.assetSequence} คดี ${p.caseNumber}`}
                >
                  เปิด
                </button>
              </td>
              {columns.map((column) => {
                const value = column.display
                  ? column.display(p)
                  : (column.value(p) ?? "—");
                return (
                  <td key={column.label}>
                    {column.truncate && typeof value === "string" ? (
                      <span className="table-text" title={value}>
                        {value}
                      </span>
                    ) : (
                      value
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
