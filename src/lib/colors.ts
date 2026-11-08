import type { EventColor } from "./types";

export const COLOR_LABELS: Record<EventColor, string> = {
  blue: "Blue",
  green: "Green",
  red: "Red",
  orange: "Orange",
  purple: "Purple",
  pink: "Pink",
  gray: "Gray",
};

/** dot = จุดสี, chip = ป้ายในปฏิทิน */
export const COLOR_CLASSES: Record<EventColor, { dot: string; chip: string; bar: string }> = {
  blue: { dot: "bg-blue-500", chip: "bg-blue-500/12 text-blue-700 dark:text-blue-300", bar: "bg-blue-500" },
  green: { dot: "bg-emerald-500", chip: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300", bar: "bg-emerald-500" },
  red: { dot: "bg-red-500", chip: "bg-red-500/12 text-red-700 dark:text-red-300", bar: "bg-red-500" },
  orange: { dot: "bg-orange-500", chip: "bg-orange-500/12 text-orange-700 dark:text-orange-300", bar: "bg-orange-500" },
  purple: { dot: "bg-violet-500", chip: "bg-violet-500/12 text-violet-700 dark:text-violet-300", bar: "bg-violet-500" },
  pink: { dot: "bg-pink-500", chip: "bg-pink-500/12 text-pink-700 dark:text-pink-300", bar: "bg-pink-500" },
  gray: { dot: "bg-zinc-400", chip: "bg-zinc-500/12 text-zinc-700 dark:text-zinc-300", bar: "bg-zinc-400" },
};

/** สีจริงของแต่ละป้าย ใช้กับจุด/เส้นที่ต้องการค่าสีตรง ๆ */
export const COLOR_HEX: Record<EventColor, string> = {
  blue: "#3b82f6",
  green: "#10b981",
  red: "#ef4444",
  orange: "#f97316",
  purple: "#8b5cf6",
  pink: "#ec4899",
  gray: "#a1a1aa",
};
