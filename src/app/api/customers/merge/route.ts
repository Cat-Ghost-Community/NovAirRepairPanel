import {NextRequest} from "next/server";
import {requireSession,requirePerm,readJson,validate,fail} from "@/lib/api";
import {POST as updateCustomer} from "../[id]/route";

export const dynamic="force-dynamic";

/** Legacy UI delegates to the same transactional ownership/financial-history safeguards. */
export async function POST(req:NextRequest){
  try{
    const session=requireSession(req);
    requirePerm(session,"customers.edit");
    const body=await readJson(req);
    const master=validate.id(body.master_id),duplicate=validate.id(body.duplicate_id);
    const headers=new Headers(req.headers);
    headers.delete("content-length");
    headers.set("content-type","application/json");
    const delegated=new NextRequest(new URL(`/api/customers/${duplicate}`,req.url),{
      method:"POST",headers,body:JSON.stringify({action:"merge_into",target_id:master}),
    });
    return updateCustomer(delegated,{params:Promise.resolve({id:String(duplicate)})});
  }catch(error){return fail(error);}
}
