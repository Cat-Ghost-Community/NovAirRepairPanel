import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresShellState} from '@/lib/db/pg-shell';
import {hasPerm} from '@/lib/perms-shared';
import { requirePageAccess } from "@/lib/page-access";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { canUser, getSessionByToken } from "@/lib/auth";
import { QueueClient } from "./queue-client";

export const dynamic = "force-dynamic";

/** کارتابل تعمیرکار — دستگاه‌های ارجاع‌شده به خودم */
export default async function QueuePage() {
  await requirePageAccess("/repairs/queue");
  const cookieStore = await cookies();
  const native=Boolean(postgresIntegration());
  const {session}=await(async()=>{
    if(native){const state=await postgresShellState(cookieStore.get('repaid_session')?.value,cookieStore.get('repaid_branch')?.value);if(!state.session)redirect('/login');if(!hasPerm(state.permissions,'repairs.view'))redirect('/repairs');return {session:state.session,branch:state.scope?.branchId??null};}
    const session=getSessionByToken(cookieStore.get('repaid_session')?.value);if(!session)redirect('/login');if(!canUser(session,'repairs.view'))redirect('/repairs');return {session,branch:session.user.branch_id};
  })();
  return (
    <div className="h-full">
      <QueueClient native={native} allowClaim={session.user.role==='technician'} userName={session.user.name.split(" ")[0]} />
    </div>
  );
}
