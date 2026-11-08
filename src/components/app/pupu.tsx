import { cn } from "@/lib/utils";

export const PUPU_POSES = ["happy", "sleepy", "cheer", "write", "money", "wave", "search", "oops"] as const;
export type PupuPose = (typeof PUPU_POSES)[number];

export const PUPU_POSE_LABELS: Record<PupuPose, string> = {
  happy: "Planning",
  sleepy: "Sleepy",
  cheer: "All done",
  write: "Writing",
  money: "Saving",
  wave: "Hello",
  search: "Looking",
  oops: "Oops",
};

const INK = "#3B2A22";
const FUR = "#FFF7E8";
const PINK = "#FFC4CF";

/**
 * Pupu — มาสคอตของ jameswebpupu (กระต่ายโมจิ)
 * ท่า: happy (กอดสมุดแพลนเนอร์), sleepy, cheer, write, money, wave, search, oops
 * หูกระดิกเมื่อชี้เมาส์ที่ตัว หรือที่ element แม่ที่มี class "group/pupu"
 */
export function Pupu({
  pose = "happy",
  size = 48,
  day,
  className,
  title,
}: {
  pose?: PupuPose;
  size?: number;
  /** ตัวเลขบนสมุด (ใช้กับ happy/sleepy/cheer/wave) */
  day?: number | string;
  className?: string;
  title?: string;
}) {
  const holdsPlanner = pose === "happy" || pose === "sleepy" || pose === "cheer" || pose === "wave";

  return (
    <svg
      viewBox="0 0 400 400"
      width={size}
      height={size}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      className={cn("pupu shrink-0 overflow-visible", className)}
    >
      {title && <title>{title}</title>}

      {/* ears + body */}
      <g stroke={INK} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round">
        <g className="pupu-ear pupu-ear-l">
          <path d="M150 150 C120 90 118 38 146 30 C176 22 186 86 182 140" fill={FUR} />
          <path d="M150 120 C140 86 140 56 150 52 C162 48 168 84 168 118" fill={PINK} stroke="none" />
        </g>
        <g className="pupu-ear pupu-ear-r">
          <path d="M250 150 C280 90 290 44 262 34 C232 26 220 86 222 140" fill={FUR} />
          <path d="M252 120 C262 86 264 60 256 56 C244 52 236 86 236 118" fill={PINK} stroke="none" />
        </g>
        <path
          d="M200 132 C292 132 338 196 338 262 C338 326 280 358 200 358 C120 358 62 326 62 262 C62 196 108 132 200 132 Z"
          fill={FUR}
        />
        <path d="M150 352 C150 370 182 370 182 352" fill={FUR} />
        <path d="M218 352 C218 370 250 370 250 352" fill={FUR} />
      </g>

      <Face pose={pose} />

      {/* what Pupu is holding */}
      {holdsPlanner && <Planner day={day} />}
      {pose === "write" && <Notebook />}
      {pose === "money" && <Coin />}
      {pose === "search" && <Magnifier />}

      <Paws pose={pose} />

      {/* extras */}
      {pose === "sleepy" && (
        <g fill={INK} fontFamily="var(--font-anuphan), sans-serif" fontWeight={600} className="pupu-z">
          <text x="300" y="150" fontSize={44}>
            z
          </text>
          <text x="336" y="108" fontSize={32}>
            z
          </text>
        </g>
      )}
      {pose === "cheer" && (
        <g stroke="#F5B301" strokeWidth={7} strokeLinecap="round">
          <path d="M60 150 L46 132 M88 140 L90 116 M340 150 L354 132 M312 140 L310 116" />
        </g>
      )}
      {pose === "money" && (
        <g fill="#F5B301" className="pupu-sparkle">
          <path d="M318 168 l6 14 14 6 -14 6 -6 14 -6 -14 -14 -6 14 -6 z" />
          <path d="M84 196 l4 9 9 4 -9 4 -4 9 -4 -9 -9 -4 9 -4 z" />
        </g>
      )}
      {pose === "oops" && (
        <path
          d="M316 168 C308 184 304 194 304 202 A12 12 0 0 0 328 202 C328 194 324 184 316 168 Z"
          fill="#9CC6FF"
          stroke={INK}
          strokeWidth={6}
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

function Face({ pose }: { pose: PupuPose }) {
  const eyes =
    pose === "sleepy" ? (
      <g fill="none" stroke={INK} strokeWidth={7} strokeLinecap="round">
        <path d="M146 236 Q160 246 174 236" />
        <path d="M226 236 Q240 246 254 236" />
      </g>
    ) : pose === "cheer" ? (
      <g fill="none" stroke={INK} strokeWidth={7} strokeLinecap="round">
        <path d="M146 238 Q160 222 174 238" />
        <path d="M226 238 Q240 222 254 238" />
      </g>
    ) : pose === "oops" ? (
      <>
        <circle cx="160" cy="236" r="9" fill={INK} />
        <circle cx="240" cy="236" r="9" fill={INK} />
        <g fill="none" stroke={INK} strokeWidth={6} strokeLinecap="round">
          <path d="M140 208 L176 216" />
          <path d="M260 208 L224 216" />
        </g>
      </>
    ) : (
      <>
        {/* looking down at the page while writing or searching */}
        <circle cx="160" cy={pose === "write" || pose === "search" ? 238 : 232} r="13" fill={INK} />
        <circle cx="164" cy={pose === "write" || pose === "search" ? 233 : 227} r="4.5" fill="#fff" />
        <circle cx="240" cy={pose === "write" || pose === "search" ? 238 : 232} r="13" fill={INK} />
        <circle cx="244" cy={pose === "write" || pose === "search" ? 233 : 227} r="4.5" fill="#fff" />
      </>
    );

  const mouth =
    pose === "cheer" || pose === "wave" ? (
      <path d="M186 254 Q200 272 214 254 Z" fill="#E86A7E" stroke={INK} strokeWidth={6} strokeLinejoin="round" />
    ) : pose === "oops" ? (
      <path d="M184 262 Q192 254 200 262 Q208 270 216 262" fill="none" stroke={INK} strokeWidth={6} strokeLinecap="round" />
    ) : (
      <path d="M186 254 Q193 264 200 254 Q207 264 214 254" fill="none" stroke={INK} strokeWidth={6} strokeLinecap="round" />
    );

  return (
    <>
      {eyes}
      <ellipse cx="128" cy="262" rx="19" ry="11" fill="#FFB3C1" opacity={0.75} />
      <ellipse cx="272" cy="262" rx="19" ry="11" fill="#FFB3C1" opacity={0.75} />
      {mouth}
    </>
  );
}

function Planner({ day }: { day?: number | string }) {
  return (
    <>
      <g stroke={INK} strokeWidth={8} strokeLinejoin="round">
        <rect x="150" y="282" width="100" height="72" rx="10" fill="#2952E3" />
        <path d="M150 300 H250" stroke="#fff" strokeWidth={6} opacity={0.9} />
        <path d="M172 276 V290 M228 276 V290" strokeLinecap="round" />
      </g>
      {day !== undefined && (
        <text
          x="200"
          y="342"
          textAnchor="middle"
          fontFamily="var(--font-anuphan), sans-serif"
          fontWeight={600}
          fontSize={34}
          fill="#fff"
        >
          {day}
        </text>
      )}
    </>
  );
}

function Notebook() {
  return (
    <g stroke={INK} strokeWidth={8} strokeLinejoin="round">
      <path d="M128 290 L200 300 L272 290 L272 352 L200 360 L128 352 Z" fill="#fff" />
      <path d="M200 300 V360" />
      <g stroke="#2952E3" strokeWidth={5} strokeLinecap="round" opacity={0.85}>
        <path d="M144 312 L186 317 M144 328 L186 333 M214 317 L256 312" />
      </g>
      {/* pencil */}
      <g transform="rotate(38 262 300)">
        <rect x="252" y="236" width="22" height="70" rx="4" fill="#FFD24D" />
        <rect x="252" y="230" width="22" height="14" rx="4" fill={PINK} />
        <path d="M252 306 L263 330 L274 306 Z" fill={FUR} />
      </g>
    </g>
  );
}

function Coin() {
  return (
    <g stroke={INK} strokeWidth={8}>
      <circle cx="200" cy="314" r="46" fill="#FFD24D" />
      <circle cx="200" cy="314" r="33" fill="none" stroke="#E0A800" strokeWidth={5} />
      <text
        x="200"
        y="330"
        textAnchor="middle"
        fontFamily="var(--font-anuphan), sans-serif"
        fontWeight={600}
        fontSize={44}
        fill={INK}
        stroke="none"
      >
        ฿
      </text>
    </g>
  );
}

function Magnifier() {
  return (
    <g stroke={INK} strokeWidth={8} strokeLinecap="round">
      <path d="M262 334 L300 372" strokeWidth={16} />
      <path d="M262 334 L300 372" stroke="#2952E3" strokeWidth={8} />
      <circle cx="230" cy="302" r="40" fill="#E3EEFF" />
      <path d="M210 288 Q216 276 230 274" fill="none" stroke="#fff" strokeWidth={7} />
    </g>
  );
}

function Paws({ pose }: { pose: PupuPose }) {
  const paw = (cx: number, cy: number, key?: string) => <ellipse key={key} cx={cx} cy={cy} rx="18" ry="15" />;
  return (
    <g stroke={INK} strokeWidth={8} fill={FUR}>
      {pose === "cheer" && (
        <>
          {paw(78, 214)}
          {paw(322, 214)}
        </>
      )}
      {pose === "wave" && (
        <>
          {paw(146, 316)}
          <g className="pupu-wave">
            {paw(326, 196)}
            <path d="M350 160 Q362 172 360 188 M366 146 Q384 166 380 190" fill="none" strokeWidth={6} strokeLinecap="round" />
          </g>
        </>
      )}
      {pose === "write" && (
        <>
          {paw(138, 318)}
          {paw(256, 304)}
        </>
      )}
      {pose === "money" && (
        <>
          {paw(150, 304)}
          {paw(250, 304)}
        </>
      )}
      {pose === "search" && (
        <>
          {paw(140, 322)}
          {paw(276, 344)}
        </>
      )}
      {pose === "oops" && (
        <>
          {paw(110, 300)}
          {paw(290, 300)}
        </>
      )}
      {(pose === "happy" || pose === "sleepy") && (
        <>
          {paw(146, 316)}
          {paw(254, 316)}
        </>
      )}
    </g>
  );
}
