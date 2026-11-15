import type { CaseBox } from "./catalog-types";

export function EvidenceImage({
  url,
  alt,
  boxes = [],
  lazy = false,
}: {
  url: string;
  alt: string;
  boxes?: CaseBox[];
  lazy?: boolean;
}) {
  return (
    <span className="evidence-image">
      <img src={url} alt={alt} loading={lazy ? "lazy" : undefined} />
      {boxes.map(({ x, y, width, height }) => (
        <span
          key={`${x}:${y}`}
          className="case-box"
          aria-hidden="true"
          style={{
            left: `${x * 100}%`,
            top: `${y * 100}%`,
            width: `${width * 100}%`,
            height: `${height * 100}%`,
          }}
        />
      ))}
    </span>
  );
}
