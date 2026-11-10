import { beforeEach, describe, expect, it } from "vitest";
import { lockedFor, recordFailure } from "@/lib/server/login-limit";
import { freshEnv } from "./helpers/env";

beforeEach(() => {
  freshEnv();
});

describe("login lockout", () => {
  it("locks an IP after 5 failures and not before", async () => {
    for (let i = 0; i < 4; i++) expect(await recordFailure("1.1.1.1")).toBe(0);
    expect(await lockedFor("1.1.1.1")).toBe(0);
    expect(await recordFailure("1.1.1.1")).toBeGreaterThan(0);
    expect(await lockedFor("1.1.1.1")).toBeGreaterThan(0);
  });
  it("does not lock other IPs", async () => {
    for (let i = 0; i < 5; i++) await recordFailure("1.1.1.1");
    expect(await lockedFor("2.2.2.2")).toBe(0);
  });
});
