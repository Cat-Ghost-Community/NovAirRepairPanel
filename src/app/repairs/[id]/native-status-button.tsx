'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {postFinancial} from '@/lib/financial-client';
import {statusFa} from '@/lib/status-fa';
import {useToast} from '@/components/ui';
export function NativeRepairStatusButton({ticketId,version,status,color}:{ticketId:number;version:number;status:string;color?:string}){
 const [busy,setBusy]=useState(false),router=useRouter(),toast=useToast();
 return <button type="button" className="btn-secondary btn-sm" style={color?{borderColor:color+'88'}:undefined} disabled={busy} onClick={async()=>{if(busy)return;setBusy(true);try{await postFinancial(`/api/repairs/${ticketId}/status`,{status,expected_work_version:version});toast('وضعیت ثبت شد');router.refresh();}catch(error){toast(error instanceof Error?error.message:'ثبت وضعیت ناموفق بود','error');}finally{setBusy(false);}}}>{statusFa(status)}</button>;
}
