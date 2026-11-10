"use client";

import { api } from "./api";
import { useData } from "./use-data";
import { COLOR_LABELS } from "../colors";
import type { EventColor } from "../types";

/** The owner's names for the calendar colours (falls back to Blue, Green… until they rename any). */
export function useColorNames(): Record<EventColor, string> {
  const { data } = useData(() => api.colorNames().catch(() => COLOR_LABELS), []);
  return data ?? COLOR_LABELS;
}
