'use client';
import {useState} from 'react';
import {Modal} from './ui';

export function CodePreview({text,label,size=28}:{text:string;label:string;size?:number}){
 const [open,setOpen]=useState(false),[failed,setFailed]=useState(false);
 const src='/api/qr?text='+encodeURIComponent(text);
 return <>
  <button type="button" className="inline-flex shrink-0 items-center justify-center rounded-md p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600" aria-label={'بزرگ‌نمایی بارکد '+label} onClick={()=>{setFailed(false);setOpen(true);}}>
   {/* eslint-disable-next-line @next/next/no-img-element */}
   <img src={src} width={size} height={size} alt={'بارکد '+label}/>
  </button>
  <Modal open={open} onClose={()=>setOpen(false)} title={'بارکد پذیرش '+label}>
   <div className="flex min-w-0 flex-col items-center gap-4 p-3">
    {failed?<p role="alert" className="text-red-600">بارکد دریافت نشد. اتصال را بررسی و پنجره را دوباره باز کنید.</p>:<>
     {/* eslint-disable-next-line @next/next/no-img-element */}
     <img src={src} width={320} height={320} className="h-auto max-w-full rounded-lg bg-white p-3" alt={'بارکد بزرگ '+label} onError={()=>setFailed(true)}/>
    </>}
    <bdi className="break-all font-mono text-lg">{label}</bdi>
   </div>
  </Modal>
 </>;
}
