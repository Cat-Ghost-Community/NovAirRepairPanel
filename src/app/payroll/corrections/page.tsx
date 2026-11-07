import {cookies} from 'next/headers';import {notFound} from 'next/navigation';
import {requirePageAccess} from '@/lib/page-access';import {activeBranch} from '@/lib/branch';import {getDb} from '@/lib/db/schema';import {canUser} from '@/lib/auth';
import {commissionEvidence} from '@/lib/commission-settlement';import {CommissionCorrectionClient} from './correction-client';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{run_id?:string}>}){
 const session=await requirePageAccess('/payroll');if(!canUser(session,'team.view'))notFound();const id=Number((await searchParams).run_id);if(!Number.isSafeInteger(id)||id<1)notFound();
 const db=getDb(),row=db.prepare('SELECT id FROM payroll_runs WHERE id=?').get(id);if(!row)notFound();const evidence=commissionEvidence(db,id),cookie=(await cookies()).get('repaid_branch')?.value,scope=activeBranch(session,cookie);if(!scope.all&&scope.branchId!==evidence.run.branch_id)notFound();
 const employee=db.prepare('SELECT name FROM users WHERE id=?').get(evidence.run.user_id)!;
 return <CommissionCorrectionClient key={id+':'+scope.branchId} runId={id} name={String(employee.name)} canManage={canUser(session,'finance.manage')&&canUser(session,'team.manage')} canRecover={canUser(session,'payments.create')}/>;
}
