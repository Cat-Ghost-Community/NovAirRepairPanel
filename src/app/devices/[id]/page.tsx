import {readDeviceCatalog} from '@/lib/device-catalog-store';
import {deviceTypeLabel,customDeviceSpecs,DEVICE_COLUMNS} from '@/lib/device-catalog';
import {repairReadAssignedOnly} from '@/lib/repair-workflow';
import { requirePageAccess } from "@/lib/page-access";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/schema";
import { fmtDate, toFaDigits } from "@/lib/format";
import { StatusBadge } from "@/components/ui";
import { activeBranch, BRANCH_COOKIE } from "@/lib/branch";
import { cookies } from "next/headers";
import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {readyApplicationPostgres} from '@/lib/db/pg-application';
import {postgresShellState} from '@/lib/db/pg-shell';
import {PostgresDevicesRepository} from '@/lib/db/pg-operational-profiles';
import {HttpError} from '@/lib/http-error';
import {DeviceEditor} from '@/components/device-editor';
import {canUser} from '@/lib/auth';
import {hasPerm} from '@/lib/perms-shared';
import {Pagination} from '@/components/pagination';

export const dynamic = "force-dynamic";

const CONDITION_FA: Record<string, string> = {
  new: "جدید", good: "خوب", fair: "متوسط", poor: "ضعیف",
};

export default async function DeviceDetailPage({ params,searchParams }: { params: Promise<{ id: string }>;searchParams:Promise<Record<string,string|undefined>> }) {
  const session = await requirePageAccess("/devices/[id]");
  const { id } = await params;
  const sp=await searchParams;
  const {d,repairs,warranties,history,catalog}=await(async()=>{
   if(postgresIntegration()){
    const store=await cookies(),token=store.get('repaid_session')?.value,state=await postgresShellState(token,store.get(BRANCH_COOKIE)?.value),{database,schema}=await readyApplicationPostgres();
    try{const result=await new PostgresDevicesRepository(database,schema).detail(token,state.scope?.branchId??null,Number(id),Number(sp.page??1));return {catalog:result.catalog,d:result.device,repairs:result.repairs,warranties:result.warranties,history:{page:result.page,totalPages:result.totalPages,total:result.total}};}
    catch(error){if(error instanceof HttpError&&[403,404].includes(error.status))notFound();throw error;}
   }
  const db = getDb();
  const deviceId = Number(id);
  const d = db
    .prepare(
      `SELECT d.*, c.first_name, c.last_name, c.id cid, c.mobile
       FROM devices d JOIN customers c ON c.id = d.customer_id WHERE d.id = ?`
    )
    .get(deviceId) as any;
  if (!d) notFound();
  const scope = activeBranch(session, (await cookies()).get(BRANCH_COOKIE)?.value);
  if (!scope.all && !db.prepare("SELECT 1 FROM device_branch_access WHERE device_id=? AND branch_id=?").get(deviceId,scope.branchId)) notFound();

  const repairs = db
    .prepare(
      `SELECT t.*, s.name status_name, s.color status_color
       FROM repair_tickets t JOIN repair_statuses s ON s.id = t.status_id
       WHERE t.device_id = ? AND (? IS NULL OR t.branch_id=?) AND (?=0 OR t.technician_id=? OR t.technician2_id=?) ORDER BY t.created_at DESC LIMIT 200`
    )
    .all(deviceId, scope.branchId, scope.branchId,repairReadAssignedOnly(session)?1:0,session.user.id,session.user.id) as any[];

  const warranties = db.prepare("SELECT * FROM warranties WHERE ticket_id IN (SELECT id FROM repair_tickets WHERE device_id = ? AND (? IS NULL OR branch_id=?)) AND status = 'active'").all(deviceId,scope.branchId,scope.branchId) as any[];
   return {d,repairs,warranties,history:null,catalog:readDeviceCatalog(getDb())};
  })();

  const editState=postgresIntegration()?await postgresShellState((await cookies()).get('repaid_session')?.value,(await cookies()).get('repaid_branch')?.value):null;
  const canEditDevice=editState?hasPerm(editState.permissions,'devices.edit'):canUser(session,'devices.edit');
  const labels={...DEVICE_COLUMNS,...Object.fromEntries(catalog.types.find(type=>type.id===d.type)?.fields.map(field=>[field.id,field.label])??[])};
  const specs=Object.entries(labels).filter(([key])=>!['brand','model','condition','notes'].includes(key)&&Object.hasOwn(DEVICE_COLUMNS,key)&&d[key]!=null&&String(d[key]).trim()!=='').map(([key,label])=>({label,value:key==='battery_health'?String(d[key])+'%':['purchase_date','warranty_until'].includes(key)?fmtDate(d[key]):String(d[key])}));
  specs.push(...customDeviceSpecs(d.specs));

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6 space-y-4">
      <div className="card card-pad">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold">{[d.brand,d.model].filter(Boolean).join(' ')||deviceTypeLabel(catalog,d.type)}</h1>
            <div className="text-sm text-zinc-500">{deviceTypeLabel(catalog,d.type)} · <span className="font-mono">{d.imei ?? d.serial ?? "بدون شناسه"}</span></div>
            <div className="mt-1 text-sm">
              مالک: <Link href={`/customers/${d.cid}`} className="text-brand-600 hover:underline font-medium">{d.first_name} {d.last_name}</Link>
              <span className="text-zinc-400"> · {d.mobile}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2"><DeviceEditor deviceId={Number(d.id)} canEdit={canEditDevice}/><Link href={`/repairs/new`} className="btn-primary btn-sm">+ پذیرش جدید برای این دستگاه</Link></div>
        </div>
        {specs.length > 0 && (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 border-t border-zinc-200 dark:border-zinc-800 pt-3">
            {specs.map((s,index) => (
              <div key={index+'-'+s.label}>
                <div className="text-xs text-zinc-400">{s.label}</div>
                <div className="text-[13px] font-medium break-words whitespace-pre-wrap">{s.value}</div>
              </div>
            ))}
          </div>
        )}
        {d.condition && <p className="mt-3 text-sm text-zinc-500">وضعیت در آخرین پذیرش: {CONDITION_FA[d.condition] ?? d.condition}</p>}
        {d.notes&&<p className="mt-3 text-sm whitespace-pre-wrap break-words"><span className="text-zinc-500">{labels.notes}: </span>{d.notes}</p>}
      </div>

      {warranties.length > 0 && (
        <div className="card card-pad border-emerald-200 dark:border-emerald-500/30">
          <h2 className="section-title mb-2">پوشش گارانتی فعال</h2>
          {warranties.map((w) => (
            <div key={w.id} className="text-sm flex justify-between">
              <span>{w.terms ?? "گارانتی تعمیر"}</span>
              <span className="text-zinc-500">تا {fmtDate(w.end_date)}</span>
            </div>
          ))}
        </div>
      )}

      <section className="card">
        <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="section-title">سابقه کامل تعمیرها ({toFaDigits(repairs.length)})</h2>
        </div>
        {repairs.length === 0 ? (
          <p className="px-5 py-6 text-sm text-zinc-400">برای این دستگاه هنوز تعمیری ثبت نشده است.</p>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {repairs.map((t) => (
              <Link key={t.id} href={`/repairs/${t.id}`} className="block px-5 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[13px] font-semibold text-brand-600">{t.number}</span>
                  <StatusBadge name={t.status_name} color={t.status_color} />
                </div>
                <div className="text-sm text-zinc-600 dark:text-zinc-300">{t.problem}</div>
                <div className="text-xs text-zinc-400">
                  {t.repair_type} · ثبت {fmtDate(t.created_at)}
                  {t.delivered_at ? ` · تحویل ${fmtDate(t.delivered_at)}` : ""}
                  {t.is_warranty ? " · تعمیر گارانتی" : ""}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
      {history&&history.totalPages>1&&<div className="card overflow-hidden"><Pagination base={`/devices/${id}`} sp={sp} page={history.page} totalPages={history.totalPages} total={history.total} perPage={50} unit="تعمیر"/></div>}
    </div>
  );
}
