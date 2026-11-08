"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.login(password);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เข้าสู่ระบบไม่สำเร็จ");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-[340px]">
        <h1 className="text-[28px] font-semibold tracking-tight">jameswebpupu</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">ปฏิทิน บันทึก และการเงินของเจมส์</p>
        <div className="mt-8 space-y-2">
          <Label htmlFor="password">รหัสผ่าน</Label>
          <Input
            id="password"
            type="password"
            autoFocus
            autoComplete="current-password"
            className="h-10"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? "password-error" : undefined}
          />
          {error && (
            <p id="password-error" className="text-sm text-destructive">
              {error} ลองพิมพ์ใหม่อีกครั้ง
            </p>
          )}
        </div>
        <Button type="submit" className="mt-4 h-10 w-full rounded-full" disabled={pending || !password}>
          {pending && <Loader2 className="animate-spin" />}
          เข้าสู่ระบบ
        </Button>
      </form>
    </div>
  );
}
