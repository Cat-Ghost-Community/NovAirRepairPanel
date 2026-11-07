import { NextRequest, NextResponse } from "next/server";
import { sessionCookie } from "@/lib/auth";
import { authenticate } from "@/lib/login";
import { fail, readJson } from "@/lib/api";
import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresFailure} from '@/lib/db/pg-http';
import {readRequestJson} from '@/lib/request-json';

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = postgresIntegration()?await readRequestJson(req):await readJson(req);
    const token = await authenticate(body?.email, body?.password, req.cookies.get("repaid_session")?.value);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(sessionCookie(token));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if(postgresIntegration())return postgresFailure(error);
    const response = fail(error);
    if (response.status === 429) response.headers.set("Retry-After", "300");
    return response;
  }
}
