import { NextRequest } from "next/server";
import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresOperationalHttp} from '@/lib/db/pg-operational-http';
import { getDb } from "@/lib/db/schema";
import { requireSession, fail, ok, readJson, audit, requirePerm } from "@/lib/api";

export async function GET(req: NextRequest) {
  if(postgresIntegration())return postgresOperationalHttp(req,'suppliers');
  try {
    const session = requireSession(req);
    requirePerm(session, "suppliers.view");
    const db = getDb();
    return ok({ suppliers: db.prepare("SELECT * FROM suppliers WHERE is_archived = 0 ORDER BY name").all() as any[] });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  if(postgresIntegration())return postgresOperationalHttp(req,'suppliers');
  try {
    const session = requireSession(req);
    requirePerm(session, "suppliers.manage");
    const b = await readJson(req);
    const db = getDb();
    const id = db
      .prepare("INSERT INTO suppliers(name, company, phone, email, address, tax_id, payment_terms, credit_limit, bank_info, contact_person, notes) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(b.name, b.company ?? null, b.phone ?? null, b.email ?? null, b.address ?? null, b.tax_id ?? null,
        b.payment_terms ?? null, b.credit_limit ?? 0, b.bank_info ?? null, b.contact_person ?? null, b.notes ?? null)
      .lastInsertRowid as number;
    audit(session, "create", "supplier", id, null, { name: b.name });
    return ok({ id });
  } catch (e) {
    return fail(e);
  }
}
