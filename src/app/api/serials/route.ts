import { NextRequest } from "next/server";
import { getDb } from "@/lib/db/schema";
import { requireSession, requirePerm, fail, ok, readJson, audit, HttpError,validate,assertRequestSession } from "@/lib/api";
import { activeBranch, BRANCH_COOKIE, recordBranchId } from "@/lib/branch";
import { assertBranchResource } from "@/lib/branch-access";
import {atomic,readSnapshot} from '@/lib/db/transaction';
import {durableJsonResponse} from '@/lib/idempotency';
import {quantityMicro} from '@/lib/money';
import {countOf,resolvePaging,pageMeta} from '@/lib/pagination';
import {parseDate} from '@/lib/format';

export const dynamic = "force-dynamic";

/** کالای سریال‌دار — ثبت سریال، جستجو، فروش، رهگیری */
export async function GET(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "inventory.view");
    const db = getDb();
    const branch=activeBranch(session,req.cookies.get(BRANCH_COOKIE)?.value).branchId;
    const sp = req.nextUrl.searchParams;
    const q = sp.get("q")?.trim();
    const status = sp.get("status");
    const partId = sp.get("part_id");
    return readSnapshot(db,()=>{
    let sql = `SELECT s.*, p.name part_name, p.sku part_code, l.name location_name,
      sup.name supplier_name, c.first_name || ' ' || c.last_name buyer_name, t.number ticket_number
      FROM serialized_parts s
      JOIN parts p ON p.id = s.part_id
      LEFT JOIN inventory_locations l ON l.id = s.location_id
      LEFT JOIN suppliers sup ON sup.id = s.supplier_id
      LEFT JOIN sales sale ON sale.id = s.sale_id
      LEFT JOIN customers c ON c.id = sale.customer_id
      LEFT JOIN repair_tickets t ON t.id = s.ticket_id
      WHERE (? IS NULL OR COALESCE(l.branch_id,t.branch_id,sale.branch_id)=?)`;
    const params: any[] = [branch,branch];
    if (q) { sql += " AND (s.serial LIKE ? OR s.imei LIKE ? OR p.name LIKE ?)"; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    if (status) { sql += " AND s.status = ?"; params.push(status); }
    if (partId) { sql += " AND s.part_id = ?"; params.push(validate.id(partId)); }
    const total=countOf(db,sql,params),paging=resolvePaging(sp,total,50);
    const rows = db.prepare(sql+' ORDER BY s.created_at DESC,s.id DESC LIMIT ? OFFSET ?').all(...params,paging.perPage,paging.offset);
    const stats = db.prepare(`SELECT s.status,COUNT(*) c FROM serialized_parts s LEFT JOIN inventory_locations l ON l.id=s.location_id LEFT JOIN repair_tickets t ON t.id=s.ticket_id LEFT JOIN sales sale ON sale.id=s.sale_id
      WHERE (? IS NULL OR COALESCE(l.branch_id,t.branch_id,sale.branch_id)=?) GROUP BY s.status`).all(branch,branch) as any[];
    return ok({ serials: rows, stats,...pageMeta(paging.page,paging.perPage,total) });
    });
  } catch (e) {
    return fail(e);
  }
}

/** ثبت سریال جدید (خرید/ورود به انبار) */
export async function POST(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "inventory.edit");
    const b = await readJson(req);
    const db = getDb();
    const cookie=req.cookies.get(BRANCH_COOKIE)?.value,scope=activeBranch(session,cookie),fallback=recordBranchId(session,cookie);
    const location=b.location_id==null?db.prepare("SELECT id FROM inventory_locations WHERE branch_id=? ORDER BY is_default DESC,id LIMIT 1").get(fallback)?.id:validate.id(b.location_id);
    if(location==null)throw new HttpError(400,'ابتدا انبار این شعبه را تعریف کنید.');
    const warehouse=db.prepare('SELECT id,branch_id FROM inventory_locations WHERE id=?').get(location);
    if(!warehouse||warehouse.branch_id==null||!scope.all&&warehouse.branch_id!==scope.branchId)throw new HttpError(404,'انبار در شعبهٔ مجاز یافت نشد.');
    const branch=Number(warehouse.branch_id),part=validate.id(b.part_id),cost=b.cost==null?null:validate.amount(b.cost,'بهای تمام‌شده');
    if(typeof b.serial!=='string')throw new HttpError(400,'شماره سریال باید متن باشد.');
    const serial=validate.maxLength(validate.required(b.serial,'شماره سریال'),200,'شماره سریال');
    if(b.status!=null&&b.status!=='in_stock')throw new HttpError(409,'وضعیت اولیه باید در انبار باشد؛ فروش و مرجوعی به سند اصلی نیاز دارند.');
    for(const field of ['imei','batch','warranty_until','purchase_date'])if(b[field]!=null&&(typeof b[field]!=='string'||b[field].length>200))throw new HttpError(400,'اطلاعات سریال معتبر نیست.');
    for(const field of ['warranty_until','purchase_date'])if(b[field]&&(!/^\d{4}-\d{2}-\d{2}$/.test(b[field])||!parseDate(b[field])))throw new HttpError(400,'تاریخ سریال معتبر نیست.');
    if(!db.prepare('SELECT id FROM parts WHERE id=? AND is_active=1').get(part))throw new HttpError(404,'کالای فعال یافت نشد.');
    const supplier=b.supplier_id==null?null:validate.id(b.supplier_id);if(supplier!=null&&!db.prepare('SELECT id FROM suppliers WHERE id=?').get(supplier))throw new HttpError(404,'تأمین‌کننده یافت نشد.');
    const work=()=>atomic(db,()=>{
    assertRequestSession(req);requirePerm(session,'inventory.edit');
    const current=db.prepare('SELECT branch_id FROM inventory_locations WHERE id=?').get(location);if(!current||current.branch_id!==branch)throw new HttpError(409,'شعبهٔ انبار تغییر کرده است؛ دوباره بررسی کنید.');
    if(db.prepare('SELECT id FROM serialized_parts WHERE serial=?').get(serial))throw new HttpError(400,'این سریال قبلاً ثبت شده است');
    const id = db.prepare(
      "INSERT INTO serialized_parts(part_id, serial, imei, batch, warranty_until, supplier_id, purchase_date, cost, location_id, status) VALUES(?,?,?,?,?,?,?,?,?,?)"
    ).run(
      part, serial, b.imei || null, b.batch || null, b.warranty_until || null,
      supplier, b.purchase_date || new Date().toISOString().slice(0, 10),
      cost, location, 'in_stock'
    ).lastInsertRowid as number;
    audit(session, "create", "serialized_part", id, null, { serial,cost,branch_id:branch });
    return ok({ id });
    });
    const key=req.headers.get('idempotency-key');return key?durableJsonResponse(db,{actorId:session.user.id,branchId:branch,operation:'serial_create',scope:'business',key,payload:b},work):work();
  } catch (e) {
    return fail(e);
  }
}

/** تغییر وضعیت سریال: فروختن، ارسال به تعمیر، برگشت به انبار */
export async function PATCH(req: NextRequest) {
  try {
    const session = requireSession(req);
    requirePerm(session, "inventory.edit");
    const b = await readJson(req);
    const db = getDb();
    return atomic(db,()=>{
    assertRequestSession(req);requirePerm(session,'inventory.edit');
    const cookie=req.cookies.get(BRANCH_COOKIE)?.value;assertBranchResource(db,session,cookie,"serial",validate.id(b.id));
    const serial = db.prepare("SELECT s.*,l.branch_id FROM serialized_parts s LEFT JOIN inventory_locations l ON l.id=s.location_id WHERE s.id=?").get(Number(b.id))!;
    if (b.action === "sell") {
      if(b.sale_id==null)throw new HttpError(409,'فروش سریال به سند فروش و خروج واقعی کالا نیاز دارد؛ تغییر نمایشی وضعیت مجاز نیست.');
      const sale=validate.id(b.sale_id);assertBranchResource(db,session,cookie,'sale',sale);
      const source=db.prepare("SELECT branch_id,status FROM sales WHERE id=?").get(sale);
      if(!source||source.branch_id!==serial.branch_id||!['completed','credit'].includes(String(source.status)))throw new HttpError(409,'سند فروش با شعبه و وضعیت سریال مطابقت ندارد.');
      if(serial.status==='sold'&&serial.sale_id===sale)return ok({done:true,duplicate:true});
      if(serial.status!=='in_stock')throw new HttpError(409,'فقط سریال در انبار قابل تخصیص به فروش است.');
      const movements=db.prepare("SELECT qty FROM inventory_movements WHERE ref_type='sale' AND ref_id=? AND part_id=? AND location_id=? AND type='sale' AND qty<0 LIMIT 1001").all(sale,serial.part_id,serial.location_id);
      if(movements.length>1000)throw new HttpError(409,'گردش بزرگ به بررسی جداگانه نیاز دارد.');
      const delivered=movements.reduce((total,row)=>total+BigInt(quantityMicro(Math.abs(Number(row.qty)))),BigInt(0)),assigned=Number(db.prepare("SELECT COUNT(*) n FROM serialized_parts WHERE sale_id=? AND part_id=? AND location_id=?").get(sale,serial.part_id,serial.location_id)!.n);
      if(delivered<BigInt(assigned+1)*BigInt(1000000))throw new HttpError(409,'خروج واقعی کالا ظرفیت تخصیص سریال دیگری ندارد.');
      db.prepare("UPDATE serialized_parts SET status='sold',sale_id=? WHERE id=?").run(sale,Number(b.id));
    } else {
      throw new HttpError(409,'تغییر وضعیت سریال باید از سند معتبر فروش، مصرف یا مرجوعی انجام شود؛ تغییر نمایشی مجاز نیست.');
    }
    audit(session, "edit", "serialized_part", Number(b.id), serial.status, {...b,branch_id:serial.branch_id});
    return ok({ done: true });
    });
  } catch (e) {
    return fail(e);
  }
}
