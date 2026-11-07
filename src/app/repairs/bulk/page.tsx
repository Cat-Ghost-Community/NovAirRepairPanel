import {cookies} from 'next/headers';
import {recordBranchId,BRANCH_COOKIE} from '@/lib/branch';
import {canAssignRepair} from '@/lib/repair-workflow';
import { requirePageAccess } from "@/lib/page-access";
import { getDb } from "@/lib/db/schema";
import { BulkIntakeForm } from "./bulk-form";
import {canUser} from '@/lib/auth';

export const dynamic = "force-dynamic";

/** پذیرش گروهی: چند دستگاه از یک مشتری با یک مشکل متفاوت — یک قبض گروهی */
export default async function BulkRepairsPage() {
  const session=await requirePageAccess("/repairs/bulk");
  const branch=recordBranchId(session,(await cookies()).get(BRANCH_COOKIE)?.value);
  const db = getDb();
  const statuses = db.prepare("SELECT id, name FROM repair_statuses WHERE is_open = 1 ORDER BY sort LIMIT 1").all() as any[];
  const technicians = db.prepare("SELECT id, name, role FROM users WHERE is_active = 1 AND role = 'technician' AND branch_id=? ORDER BY name").all(branch) as any[];
  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight">پذیرش گروهی چند دستگاه</h1>
        <p className="text-sm text-zinc-500 mt-0.5">چند دستگاه از یک مشتری را همزمان بپذیرید — یک قبض گروهی صادر می‌شود</p>
      </div>
      <BulkIntakeForm
        canAssign={canAssignRepair(session,branch)}
        canReceive={canUser(session,'payments.create')}
        defaultStatusId={statuses[0]?.id ?? 1}
        technicians={JSON.parse(JSON.stringify(technicians))}
      />
    </div>
  );
}
