/** Hono-flavored response + body parsing helpers. */
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError, type ZodSchema } from "zod";

export function ok<T>(c: Context, data: T, status = 200) {
  return c.json({ data: serialize(data) }, status as any);
}

export function fail(c: Context, status: number, code: string, message: string, extra?: unknown) {
  return c.json({ error: { code, message, extra } }, status as any);
}

/** Parse JSON body against a Zod schema; raises HTTPException on failure. */
export async function parseJson<T>(c: Context, schema: ZodSchema<T>): Promise<T> {
  let body: unknown;
  try { body = await c.req.json(); }
  catch { throw new HTTPException(400, { message: "bad JSON body" }); }
  try { return schema.parse(body); }
  catch (e) {
    if (e instanceof ZodError) {
      throw new HTTPException(400, {
        message:
          "validation: " +
          e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      });
    }
    throw e;
  }
}

/** Recursively convert BigInt fields to strings for JSON serialization. */
export function serialize<T>(v: T): T {
  return JSON.parse(
    JSON.stringify(v, (_, val) => (typeof val === "bigint" ? val.toString() : val)),
  ) as T;
}
