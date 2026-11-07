import {postgresIntegration} from '@/lib/db/pg-integration-config';
import {postgresShellState} from '@/lib/db/pg-shell';
import {hasPerm} from '@/lib/perms-shared';
import { requirePageAccess } from "@/lib/page-access";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { canUser, getSessionByToken } from "@/lib/auth";
import { AssignmentClient } from "./assignment-client";
import { activeBranch, BRANCH_COOKIE } from "@/lib/branch";

export const dynamic = "force-dynamic";

/** کارتابل مدیر شعبه — ارجاع دستگاه‌ها به تعمیرکار */
export default async function AssignmentPage() {
  await requirePageAccess("/repairs/assignment");
  const cookieStore = await cookies();
  const native=Boolean(postgresIntegration());
  const {branch}=await(async()=>{
    if(native){const state=await postgresShellState(cookieStore.get('repaid_session')?.value,cookieStore.get('repaid_branch')?.value);if(!state.session)redirect('/login');if(!hasPerm(state.permissions,'repairs.assign'))redirect('/repairs');return {session:state.session,branch:state.scope?.branchId??null};}
    const session=getSessionByToken(cookieStore.get('repaid_session')?.value);if(!session)redirect('/login');if(!canUser(session,'repairs.assign'))redirect('/repairs');return {session,branch:activeBranch(session,cookieStore.get(BRANCH_COOKIE)?.value).branchId};
  })();
  return (
    <div className="h-full">
      <AssignmentClient native={native} key={branch ?? "all"} />
    </div>
  );
}
