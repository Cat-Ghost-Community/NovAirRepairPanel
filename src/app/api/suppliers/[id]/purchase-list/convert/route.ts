import {NextRequest} from 'next/server';import {getDb} from '@/lib/db/schema';import {BRANCH_COOKIE,recordBranchId} from '@/lib/branch';
import {requireSession,requirePerm,readJson,validate,ok,fail} from '@/lib/api';import {durableJsonResponse} from '@/lib/idempotency';
import {convertSupplierPurchaseList} from '@/lib/supplier-purchase-conversion';
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){try{
 const session=requireSession(req);requirePerm(session,'purchasing.manage');const supplier=validate.id((await params).id),body=req.body?await readJson(req):{},branch=recordBranchId(session,req.cookies.get(BRANCH_COOKIE)?.value),db=getDb();
 return durableJsonResponse(db,{actorId:session.user.id,branchId:branch,operation:'supplier_list_convert',key:req.headers.get('idempotency-key'),payload:{supplier_id:supplier,...body}},()=>ok(convertSupplierPurchaseList(db,session,supplier,branch,body)));
}catch(error){return fail(error);}}