"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DATA_CHANGED_EVENT } from "./api";

/**
 * โหลดข้อมูลแบบง่าย ๆ (stale-while-revalidate)
 * โหลดใหม่อัตโนมัติเมื่อ deps เปลี่ยน, มีการแก้ไขข้อมูล หรือกลับมาที่แท็บ
 */
export function useData<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loaderRef = useRef(loader);
  const seq = useRef(0);

  useEffect(() => {
    loaderRef.current = loader;
  });

  const reload = useCallback(async () => {
    const id = ++seq.current;
    try {
      const d = await loaderRef.current();
      if (id === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (id === seq.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    const onChange = () => void reload();
    const onVisible = () => document.visibilityState === "visible" && reload();
    window.addEventListener(DATA_CHANGED_EVENT, onChange);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(DATA_CHANGED_EVENT, onChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reload]);

  return { data, error, loading, reload };
}
