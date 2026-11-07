import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { requirePageAccess } from '@/lib/page-access';
import { getSessionByToken,canUser } from '@/lib/auth';
import { ReturnsClient } from './returns-client';
export const dynamic='force-dynamic';
export default async function ReturnsPage({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
 await requirePageAccess('/returns');const store=await cookies(),session=getSessionByToken(store.get('repaid_session')?.value);if(!session)redirect('/login');const q=await searchParams;
 return <ReturnsClient key={store.get('repaid_branch')?.value??'default'} initialInvoice={Number(q.invoice_id)||0} initialReturn={Number(q.return_id)||0}
 permissions={{edit:canUser(session,'invoices.edit'),inventory:canUser(session,'inventory.manage'),finance:canUser(session,'finance.manage'),refund:canUser(session,'payments.refund'),admin:['owner','admin'].includes(session.user.role)}}/>;
}
