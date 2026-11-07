import { NextRequest, NextResponse } from "next/server";
import { destroySession, sessionCookie } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/request-security";
import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {readyApplicationPostgres} from '@/lib/db/pg-application';
import {destroyPostgresSession} from '@/lib/db/pg-app-auth';
import {postgresFailure} from '@/lib/db/pg-http';

// GET stays safe: prefetches and external links cannot invalidate a session.
export async function GET(req: NextRequest) {
  return NextResponse.redirect(new URL("/login", req.url), 303);
}

export async function POST(req: NextRequest) {
  if (!isSameOriginMutation(req)) return NextResponse.json({ error: "درخواست از منبع غیرمجاز رد شد." }, { status: 403 });
  try{if(postgresIntegration()){const {database,schema}=await readyApplicationPostgres();await destroyPostgresSession(database,schema,req.cookies.get('repaid_session')?.value);}else destroySession(req.cookies.get("repaid_session")?.value);}catch(error){return postgresFailure(error);}
  const response = NextResponse.redirect(new URL("/login", req.url), 303);
  response.cookies.set({ ...sessionCookie(""), maxAge: 0 });
  return response;
}
