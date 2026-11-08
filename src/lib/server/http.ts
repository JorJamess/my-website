import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { isAuthed } from "./auth";
import { InputError } from "./repo";
import { MoneyUnavailableError } from "./money";

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** ห่อ route handler: ตรวจ login + แปลง error เป็น JSON */
export function api<C>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    if (!(await isAuthed())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    try {
      return await handler(req, ctx);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown) {
  if (err instanceof ZodError)
    return NextResponse.json({ error: "invalid_input", issues: err.issues }, { status: 400 });
  if (err instanceof InputError) return NextResponse.json({ error: err.message }, { status: 400 });
  if (err instanceof MoneyUnavailableError)
    return NextResponse.json({ error: err.message, unavailable: true }, { status: err.status });
  console.error(err);
  return NextResponse.json({ error: "server_error" }, { status: 500 });
}

export const notFound = () => NextResponse.json({ error: "not_found" }, { status: 404 });
