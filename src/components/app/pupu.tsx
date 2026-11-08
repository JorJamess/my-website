import { cn } from "@/lib/utils";

export type PupuMood = "happy" | "sleepy" | "cheer";

/**
 * Pupu — มาสคอตของ jameswebpupu (กระต่ายโมจิกอดสมุด)
 * - happy: ปกติ
 * - sleepy: หลับตา มี z (ใช้กับหน้าว่าง)
 * - cheer: ยิ้มตาปิด แขนชูขึ้น (ทำงานวันนี้ครบ)
 * หูกระดิกเมื่อชี้เมาส์ที่ตัว หรือที่ element แม่ที่มี class "group/pupu"
 */
export function Pupu({
  mood = "happy",
  size = 48,
  day,
  className,
  title,
}: {
  mood?: PupuMood;
  size?: number;
  /** ตัวเลขบนสมุด (ค่าเริ่มต้น: ไม่มี) */
  day?: number | string;
  className?: string;
  title?: string;
}) {
  const ink = "#3B2A22";
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
      <g stroke={ink} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round">
        <g className="pupu-ear pupu-ear-l">
          <path d="M150 150 C120 90 118 38 146 30 C176 22 186 86 182 140" fill="#FFF7E8" />
          <path d="M150 120 C140 86 140 56 150 52 C162 48 168 84 168 118" fill="#FFC4CF" stroke="none" />
        </g>
        <g className="pupu-ear pupu-ear-r">
          <path d="M250 150 C280 90 290 44 262 34 C232 26 220 86 222 140" fill="#FFF7E8" />
          <path d="M252 120 C262 86 264 60 256 56 C244 52 236 86 236 118" fill="#FFC4CF" stroke="none" />
        </g>
        <path
          d="M200 132 C292 132 338 196 338 262 C338 326 280 358 200 358 C120 358 62 326 62 262 C62 196 108 132 200 132 Z"
          fill="#FFF7E8"
        />
        <path d="M150 352 C150 370 182 370 182 352" fill="#FFF7E8" />
        <path d="M218 352 C218 370 250 370 250 352" fill="#FFF7E8" />
      </g>

      {/* eyes */}
      {mood === "happy" ? (
        <>
          <circle cx="160" cy="232" r="13" fill={ink} />
          <circle cx="164" cy="227" r="4.5" fill="#fff" />
          <circle cx="240" cy="232" r="13" fill={ink} />
          <circle cx="244" cy="227" r="4.5" fill="#fff" />
        </>
      ) : mood === "sleepy" ? (
        <g fill="none" stroke={ink} strokeWidth={7} strokeLinecap="round">
          <path d="M146 236 Q160 246 174 236" />
          <path d="M226 236 Q240 246 254 236" />
        </g>
      ) : (
        <g fill="none" stroke={ink} strokeWidth={7} strokeLinecap="round">
          <path d="M146 238 Q160 222 174 238" />
          <path d="M226 238 Q240 222 254 238" />
        </g>
      )}
      <ellipse cx="128" cy="262" rx="19" ry="11" fill="#FFB3C1" opacity={0.75} />
      <ellipse cx="272" cy="262" rx="19" ry="11" fill="#FFB3C1" opacity={0.75} />
      {mood === "cheer" ? (
        <path d="M186 254 Q200 272 214 254 Z" fill="#E86A7E" stroke={ink} strokeWidth={6} strokeLinejoin="round" />
      ) : (
        <path d="M186 254 Q193 264 200 254 Q207 264 214 254" fill="none" stroke={ink} strokeWidth={6} strokeLinecap="round" />
      )}

      {/* planner */}
      <g stroke={ink} strokeWidth={8} strokeLinejoin="round">
        <rect x="150" y="282" width="100" height="72" rx="10" fill="#2952E3" />
        <path d="M150 300 H250" stroke="#fff" strokeWidth={6} opacity={0.9} />
        <path d="M172 276 V290 M228 276 V290" strokeLinecap="round" />
      </g>
      {day !== undefined && (
        <text x="200" y="342" textAnchor="middle" fontFamily="var(--font-anuphan), sans-serif" fontWeight={600} fontSize={34} fill="#fff">
          {day}
        </text>
      )}

      {/* paws: on the book, or raised when cheering */}
      <g stroke={ink} strokeWidth={8} fill="#FFF7E8">
        {mood === "cheer" ? (
          <>
            <ellipse cx="78" cy="214" rx="18" ry="15" />
            <ellipse cx="322" cy="214" rx="18" ry="15" />
          </>
        ) : (
          <>
            <ellipse cx="146" cy="316" rx="18" ry="15" />
            <ellipse cx="254" cy="316" rx="18" ry="15" />
          </>
        )}
      </g>

      {mood === "sleepy" && (
        <g fill={ink} fontFamily="var(--font-anuphan), sans-serif" fontWeight={600} className="pupu-z">
          <text x="300" y="150" fontSize={44}>z</text>
          <text x="336" y="108" fontSize={32}>z</text>
        </g>
      )}
      {mood === "cheer" && (
        <g stroke="#F5B301" strokeWidth={7} strokeLinecap="round">
          <path d="M60 150 L46 132 M88 140 L90 116 M340 150 L354 132 M312 140 L310 116" />
        </g>
      )}
    </svg>
  );
}
