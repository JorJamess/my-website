"use client";

import { useState } from "react";
import { CalendarDays, Loader2 } from "lucide-react";
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
    <div className="flex min-h-dvh items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-xs space-y-5">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <CalendarDays className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold">My Website</h1>
            <p className="text-sm text-muted-foreground">ใส่รหัสผ่านเพื่อเข้าใช้งาน</p>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">รหัสผ่าน</Label>
          <Input
            id="password"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!error}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <Button type="submit" className="w-full" size="lg" disabled={pending || !password}>
          {pending && <Loader2 className="animate-spin" />}
          เข้าสู่ระบบ
        </Button>
      </form>
    </div>
  );
}
