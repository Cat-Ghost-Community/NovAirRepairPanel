import { requirePageAccess } from "@/lib/page-access";
import { AccountingClient } from "./accounting-client";
import { cookies } from "next/headers";
export const dynamic="force-dynamic";
export default async function AccountingPage({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){await requirePageAccess("/finance/accounting");const q=await searchParams;return <AccountingClient key={(await cookies()).get("repaid_branch")?.value??"default"} initialEventSource={(q.event_source??'').slice(0,30)} initialEventId={/^\d+$/.test(q.event_source_id??'')?q.event_source_id!:''}/>;}
