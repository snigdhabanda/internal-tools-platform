import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType, type ZodTypeDef } from "zod";
import { BadRequestError, HttpError } from "./errors";

export function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof ZodError) {
    return NextResponse.json({ error: "Validation failed", issues: error.issues }, { status: 400 });
  }
  console.error(error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

/** Wraps a route handler so thrown HttpErrors become JSON error responses. */
export function route<Ctx>(handler: (req: NextRequest, ctx: Ctx) => Promise<Response>) {
  return async (req: NextRequest, ctx: Ctx): Promise<Response> => {
    try {
      return await handler(req, ctx);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export async function parseBody<T>(req: NextRequest, schema: ZodType<T, ZodTypeDef, unknown>): Promise<T> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new BadRequestError("Body must be valid JSON");
  }
  return schema.parse(json);
}
