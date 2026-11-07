import { getDb } from "@/lib/db/schema";
import pkg from "../../../../package.json";
import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {readyApplicationPostgres} from '@/lib/db/pg-application';

// بررسی سلامت سرور — بدون احراز هویت (در middleware عمومی است)
// برای healthcheck داکر/nginx/systemd و پایش بیرونی.
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  try {
    if(postgresIntegration()){await (await readyApplicationPostgres()).database.query('SELECT 1');return Response.json({status:'ok',database:'ok',engine:'postgres',integration_only:true},{headers:{'Cache-Control':'no-store'}});}
    const db = getDb();
    db.prepare("SELECT 1").get();
    return Response.json(
      {
        status: "ok",
        version: pkg.version,
        database: "ok",
        checks: { dbMs: Date.now() - startedAt },
        time: new Date().toISOString(),
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (err) {
    console.error("[health]", err);
    return Response.json(
      { status: "error", database: "unavailable", error: "خطا در دسترسی به دیتابیس" },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
}
