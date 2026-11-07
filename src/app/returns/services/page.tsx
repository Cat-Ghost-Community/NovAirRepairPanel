import {requirePageAccess} from '@/lib/page-access';import {canUser} from '@/lib/auth';import {ServiceCreditClient} from './service-client';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{invoice_id?:string}>}){const session=await requirePageAccess('/finance');
 const id=Number((await searchParams).invoice_id);return <ServiceCreditClient invoiceId={Number.isSafeInteger(id)&&id>0?id:0} canManage={canUser(session,'finance.manage')} canReverse={['owner','admin'].includes(session.user.role)}/>;}
