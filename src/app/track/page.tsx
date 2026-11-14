import Link from "next/link";
import { getDb } from "@/lib/db/schema";
import { TrackLookup } from "./track-lookup";
import {trackingExample} from '@/lib/tracking-example';

export const dynamic = "force-dynamic";

export default async function TrackPage({searchParams}:{searchParams:Promise<{ticket?:string}>}) {
  const query=await searchParams,initialTicket=typeof query.ticket==='string'?query.ticket.slice(0,100):'';
  const settings=Object.fromEntries((getDb().prepare("SELECT key,value FROM settings WHERE key IN ('tracking_ticket_example','ticket_prefix','ticket_suffix')").all() as {key:string;value:string}[]).map(row=>[row.key,row.value]));
  return (
    <div className="min-h-dvh bg-zinc-100 dark:bg-zinc-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white text-2xl font-bold">R</span>
          <h1 className="mt-3 text-xl font-bold">پیگیری تعمیر</h1>
          <p className="text-sm text-zinc-500 mt-1">شماره پذیرش و شماره تماسی که هنگام پذیرش دادید را وارد کنید.</p>
        </div>
        <div className="card card-pad">
          <TrackLookup example={trackingExample(settings)} initialTicket={initialTicket}/>
        </div>
        <p className="mt-4 text-center text-xs text-zinc-400">
          <Link href="/login" className="hover:underline">ورود کارکنان</Link>
        </p>
      </div>
    </div>
  );
}
