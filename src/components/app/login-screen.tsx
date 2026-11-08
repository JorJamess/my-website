"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pupu } from "./pupu";

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
      setError(err instanceof Error ? err.message : "Couldn't log in");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-[340px]">
        <Pupu size={76} className="motion-rise mb-4 -ml-2" title="Pupu" />
        <h1 className="text-[28px] font-semibold tracking-tight">
          jameswebpupu<span className="text-brand">.</span>
        </h1>
        <p className="mt-1 text-[15px] text-muted-foreground">Calendar, notes and money in one place.</p>
        <div className="mt-8 space-y-2">
          <Label htmlFor="password">Password</Label>
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
              {error}.
            </p>
          )}
        </div>
        <Button type="submit" className="mt-4 h-10 w-full rounded-full" disabled={pending || !password}>
          {pending && <Loader2 className="animate-spin" />}
          Log in
        </Button>
      </form>
    </div>
  );
}
