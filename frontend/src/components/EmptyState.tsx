import type { ReactNode } from "react";

type Art = "library" | "missing" | "error";

/** Decorative illustrations; the heading and text carry the meaning for assistive tech. */
function Illustration({ art }: { art: Art }) {
  return (
    <svg
      className="empty-art"
      viewBox="0 0 220 160"
      width="220"
      height="160"
      aria-hidden="true"
      focusable="false"
    >
      <ellipse cx="110" cy="146" rx="78" ry="8" className="empty-art-shadow" />
      {/* back transcript card */}
      <g transform="rotate(-8 82 78)">
        <rect x="40" y="30" width="84" height="104" rx="10" className="empty-art-card-back" />
      </g>
      {/* front transcript card */}
      <rect x="70" y="22" width="92" height="114" rx="11" className="empty-art-card" />
      <circle cx="86" cy="42" r="5" className="empty-art-accent" />
      <rect x="96" y="39" width="40" height="6" rx="3" className="empty-art-line-strong" />
      <rect x="84" y="56" width="64" height="5" rx="2.5" className="empty-art-line" />
      <rect x="84" y="67" width="52" height="5" rx="2.5" className="empty-art-line" />
      <circle cx="86" cy="86" r="5" className="empty-art-accent-soft" />
      <rect x="96" y="83" width="34" height="6" rx="3" className="empty-art-line-strong" />
      <rect x="84" y="100" width="60" height="5" rx="2.5" className="empty-art-line" />
      <rect x="84" y="111" width="44" height="5" rx="2.5" className="empty-art-line" />

      {art === "library" && (
        <g>
          {/* speech bubble with a waveform */}
          <path
            d="M146 18h50a12 12 0 0 1 12 12v24a12 12 0 0 1-12 12h-26l-12 11v-11h-12a12 12 0 0 1-12-12V30a12 12 0 0 1 12-12z"
            className="empty-art-bubble"
          />
          {[0, 1, 2, 3, 4, 5].map(i => {
            const h = [10, 20, 28, 16, 24, 12][i];
            return (
              <rect
                key={i}
                x={152 + i * 8}
                y={42 - h / 2}
                width="4"
                height={h}
                rx="2"
                className="empty-art-wave"
              />
            );
          })}
          <circle cx="40" cy="28" r="4" className="empty-art-spark" />
          <circle cx="198" cy="104" r="3" className="empty-art-spark" />
          <path d="M26 92l4 0M28 90l0 4" className="empty-art-plus" />
        </g>
      )}

      {art === "missing" && (
        <g>
          {/* magnifier over the card */}
          <circle cx="168" cy="96" r="24" className="empty-art-lens" />
          <circle cx="168" cy="96" r="24" className="empty-art-lens-ring" />
          <path d="M185 113l17 17" className="empty-art-handle" />
          <path
            d="M161 89a7 7 0 1 1 9.5 6.5c-1.6.7-2.5 2-2.5 3.7v1.3"
            className="empty-art-question"
          />
          <circle cx="168" cy="107" r="2.4" className="empty-art-question-dot" />
        </g>
      )}

      {art === "error" && (
        <g>
          <circle cx="170" cy="100" r="22" className="empty-art-warn" />
          <path d="M170 89v13" className="empty-art-warn-mark" />
          <circle cx="170" cy="110" r="2.4" className="empty-art-warn-dot" />
        </g>
      )}
    </svg>
  );
}

export function EmptyState({
  art,
  title,
  children,
  actions,
  role,
}: {
  art: Art;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  role?: "status" | "alert";
}) {
  return (
    <div className="empty-state" role={role}>
      <Illustration art={art} />
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {actions && <div className="empty-actions">{actions}</div>}
    </div>
  );
}
