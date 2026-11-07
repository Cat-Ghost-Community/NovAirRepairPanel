"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EmptyState, Modal, useToast, PriorityBadge } from "@/components/ui";
import { Icon } from "@/components/icon";
import { Checkbox } from "@/components/checkbox";
import { SearchableSelect } from "@/components/searchable-select";
import { statusFa } from "@/lib/status-fa";
import { fmtMoney, faNum } from "@/lib/format";
import { boardHref, type BoardView } from "@/lib/board-shared";
import { workflowError } from "@/lib/repair-workflow-shared";

type Card = {
  id:number;number:string;priority:string;problem:string|null;estimated_completion:string|null;
  status_id:number;status_name:string;brand:string;model:string;first_name:string;last_name:string;
  technician_id:number|null;technician2_id:number|null;tech_name:string|null;branch_name:string|null;balance:number;is_warranty:number;
};
type Col={id:number;name:string;color:string;is_open:number;allowed_next:string[];total:number};
type Props={statuses:Col[];tickets:Card[];canMove:boolean;workerId?:number;view:BoardView;compact:boolean;activeStatus:string;query:Record<string,string|undefined>};

export function BoardClient({statuses,tickets,canMove,workerId,view,compact,activeStatus,query}:Props){
 const router=useRouter(),toast=useToast();
 const [items,setItems]=useState(tickets);
 const [dragId,setDragId]=useState<number|null>(null),[overCol,setOverCol]=useState<number|null>(null);
 const [busy,setBusy]=useState(false),[showEmpty,setShowEmpty]=useState(false);
 const [refreshing,startRefresh]=useTransition();
 const lock=useRef(false),columns=useRef<HTMLDivElement>(null);
 const [pending,setPending]=useState<{card:Card;status:Col;key:string}|null>(null);
 const [note,setNote]=useState(''),[error,setError]=useState<string|null>(null);
 const allowed=(card:Card)=>canMove&&(workerId===undefined||card.technician_id===workerId||card.technician2_id===workerId);
 const nextStates=(card:Card)=>statuses.filter(s=>s.id===card.status_id||statuses.find(current=>current.id===card.status_id)?.allowed_next.includes(s.name));
 const propose=(card:Card,status:Col)=>{
  setDragId(null);setOverCol(null);
  if(!allowed(card)||busy||card.status_id===status.id)return;
  if(!nextStates(card).some(s=>s.id===status.id)){toast('این تغییر وضعیت از مرحله فعلی مجاز نیست.','error');return;}
  if(status.name==='Cancelled'||status.name==='Delivered'){router.push(`/repairs/${card.id}${status.name==='Cancelled'?'#cancellation':''}`);return;}
  setError(null);setNote('');setPending({card,status,key:crypto.randomUUID()});
 };
 const commit=async()=>{
  if(!pending||lock.current)return;lock.current=true;setBusy(true);setError(null);
  try{
   const response=await fetch(`/api/repairs/${pending.card.id}/status`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':pending.key},body:JSON.stringify({status:pending.status.name,note})});
   const data=await response.json().catch(()=>null);
   if(!response.ok||data?.ok!==true)throw new Error(data?.error??'تغییر وضعیت تأیید نشد؛ دوباره تلاش کنید.');
   setItems(prev=>prev.map(t=>t.id===pending.card.id?{...t,status_id:pending.status.id,status_name:pending.status.name}:t));
   toast(`وضعیت ${pending.card.number} به «${statusFa(pending.status.name)}» تغییر کرد.`);setPending(null);router.refresh();
  }catch(e){setError(workflowError(e,'ارتباط برقرار نشد؛ وضعیت را بررسی و با همین درخواست دوباره تلاش کنید.'));}
  finally{lock.current=false;setBusy(false);}
 };
 const draggedCard=items.find(t=>t.id===dragId);
 const visible=statuses.filter(s=>activeStatus?String(s.id)===activeStatus:showEmpty||s.total>0||(view==='board'&&draggedCard&&nextStates(draggedCard).some(next=>next.id===s.id)));
 const statusPicker=(card:Card)=>allowed(card)?<SearchableSelect aria-label={`تغییر وضعیت ${card.number}`} className="input text-xs" disabled={busy} value={String(card.status_id)} onChange={e=>{const status=statuses.find(s=>s.id===Number(e.target.value));if(status)propose(card,status);}}>{nextStates(card).map(s=><option key={s.id} value={s.id}>{statusFa(s.name)}</option>)}</SearchableSelect>:<span className="badge-gray max-w-full whitespace-normal">{statusFa(card.status_name)}</span>;
 const renderCard=(card:Card,list=false)=><article key={card.id} draggable={view==='board'&&allowed(card)&&!busy}
  onDragStart={event=>{setDragId(card.id);event.dataTransfer.setData('text/plain',String(card.id));event.dataTransfer.effectAllowed='move';}}
  onDragEnd={()=>{setDragId(null);setOverCol(null);}}
  className={`min-w-0 ${list?'grid items-center gap-3 border-b border-zinc-100 p-4 last:border-b-0 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(160px,.9fr)] dark:border-zinc-800':'card '+(compact?'p-3':'p-4')} ${view==='board'&&allowed(card)?'cursor-grab active:cursor-grabbing':''} ${dragId===card.id?'opacity-40':''}`}>
   <div className="min-w-0"><div className="flex flex-wrap items-center justify-between gap-2"><Link href={`/repairs/${card.id}`} className="font-mono text-xs font-bold text-brand-600 hover:underline">{card.number}</Link><PriorityBadge p={card.priority} /></div><Link href={`/repairs/${card.id}`} className="mt-2 block break-words text-sm font-semibold hover:text-brand-600">{card.brand} {card.model}</Link>{!list&&!compact&&card.problem&&<p className="mt-2 line-clamp-2 break-words text-xs leading-6 text-zinc-500">{card.problem}</p>}</div>
   <p className={`${list?'':'mt-1'} truncate text-xs text-zinc-500`}>{card.first_name} {card.last_name}</p>
   <div className={`${list?'':'mt-3'} flex flex-wrap items-center gap-1.5`}><span className="chip max-w-full break-words whitespace-normal"><Icon name="user" size={12} />{card.tech_name||'ارجاع‌نشده'}</span>{card.branch_name&&<span className="max-w-full break-words text-[11px] text-zinc-500">{card.branch_name}</span>}{!!card.is_warranty&&<span className="badge-purple">گارانتی</span>}{card.balance>0&&<span className="badge-amber max-w-full break-words whitespace-normal">مانده {fmtMoney(card.balance)}</span>}</div>
   <div className={list?'min-w-0':`mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800`}>{statusPicker(card)}</div>
 </article>;
 return <div className="min-w-0 space-y-4" aria-busy={busy||refreshing}>
  <div className="card sticky top-0 z-10 space-y-3 p-3 shadow-sm sm:p-4">
   <div className="flex flex-wrap items-center justify-between gap-3">
    <nav className="flex max-w-full flex-wrap gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800" aria-label="چیدمان تابلوی وضعیت">{([['overview','نمای کلی','grid'],['board','تابلوی ستونی','board'],['list','فهرست','list']] as const).map(([mode,label,icon])=><Link key={mode} href={boardHref(query,{view:mode},false)} aria-current={view===mode?'page':undefined} className={`${view===mode?'bg-white text-brand-700 shadow-sm dark:bg-zinc-700 dark:text-brand-300':'text-zinc-500 hover:bg-white/60 dark:hover:bg-zinc-700/60'} inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-brand-500`}><Icon name={icon} size={15} />{label}</Link>)}</nav>
    <div className="flex flex-wrap items-center gap-2"><Link href={boardHref(query,{density:compact?null:'compact'},false)} className="btn-secondary btn-sm" aria-label={compact?'فاصله‌گذاری راحت':'چیدمان فشرده'}><Icon name="list" size={14} />{compact?'نمای راحت':'نمای فشرده'}</Link><button className="btn-ghost btn-sm" disabled={busy||refreshing} onClick={()=>startRefresh(()=>router.refresh())}><Icon name="refresh" size={14} />{refreshing?'در حال تازه‌سازی…':'تازه‌سازی'}</button></div>
   </div>
   <div className="flex flex-wrap items-end justify-between gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
    <div className="w-full min-w-0 sm:max-w-80"><label htmlFor="board-stage" className="label">رفتن به مرحله</label><SearchableSelect id="board-stage" value={activeStatus} onChange={e=>router.push(boardHref(query,{status:e.target.value||null,view:view==='board'?'overview':view}))}><option value="">همه مرحله‌ها</option>{statuses.map(s=><option key={s.id} value={s.id}>{statusFa(s.name)} · {faNum(s.total)}</option>)}</SearchableSelect></div>
    {!activeStatus&&view!=='list'&&<Checkbox label="نمایش مرحله‌های خالی" checked={showEmpty} onCheckedChange={value=>setShowEmpty(value)}><span className="text-xs text-zinc-500">مرحله‌های خالی</span></Checkbox>}
    <p className="text-xs leading-6 text-zinc-500">{!activeStatus&&view!=='list'?`خلاصهٔ ${view==='board'?'۲۰':compact?'۴':'۳'} پذیرش اولویت‌دار از هر مرحله · برای ادامه، مرحله را باز کنید.`:`${faNum(items.length)} پذیرش در این صفحه · شمارنده مرحله‌ها برای کل نتایج است.`}</p>
   </div>
  </div>
  {!items.length?<div className="card"><EmptyState icon="board" title="پذیرشی با این فیلترها نیست" body="مرحله، تعمیرکار یا عبارت جستجو را تغییر دهید." action={<Link href={boardHref(query,{status:null,q:null,tech:null})} className="btn-secondary">نمایش همه پذیرش‌ها</Link>} /></div>:view==='list'?<div className="card overflow-hidden"><div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(160px,.9fr)] gap-3 border-b border-zinc-200 bg-zinc-50 p-4 text-xs font-semibold text-zinc-500 md:grid dark:border-zinc-800 dark:bg-zinc-800/40"><span>پذیرش و دستگاه</span><span>مشتری</span><span>مسئول و شعبه</span><span>وضعیت / تغییر مرحله</span></div>{items.map(card=>renderCard(card,true))}</div>:<>
   {view==='board'&&<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500"><p>کارت را جابه‌جا کنید یا از انتخابگر وضعیت استفاده کنید.</p><div className="flex gap-2"><button className="btn-secondary btn-sm" aria-label="مرحله‌های سمت راست" onClick={()=>columns.current?.scrollBy({left:320,behavior:'smooth'})}><Icon name="chevron-right" size={16} /></button><button className="btn-secondary btn-sm" aria-label="مرحله‌های سمت چپ" onClick={()=>columns.current?.scrollBy({left:-320,behavior:'smooth'})}><Icon name="chevron-left" size={16} /></button></div></div>}
   <div ref={columns} role="region" tabIndex={view==='board'?0:undefined} aria-label="ستون‌های تابلوی وضعیت" className={view==='board'?'flex h-[min(65dvh,720px)] min-h-[360px] min-w-0 items-stretch gap-3 overflow-x-auto pb-3 focus-visible:outline-2 focus-visible:outline-brand-500':`grid min-w-0 items-start gap-4 ${activeStatus?'grid-cols-1':'lg:grid-cols-2 2xl:grid-cols-3'}`}>
    {visible.map(col=>{
     const cards=items.filter(t=>t.status_id===col.id),shown=view==='overview'&&!activeStatus?cards.slice(0,compact?4:3):cards;
     const dragged=items.find(t=>t.id===dragId),droppable=!!dragged&&allowed(dragged)&&nextStates(dragged).some(s=>s.id===col.id);
     return <section key={col.id} aria-label={statusFa(col.name)}
      onDragOver={event=>{if(!droppable)return;event.preventDefault();setOverCol(col.id);const rect=columns.current?.getBoundingClientRect();if(rect){if(event.clientX<rect.left+48)columns.current?.scrollBy({left:-24});else if(event.clientX>rect.right-48)columns.current?.scrollBy({left:24});}}}
      onDragLeave={()=>setOverCol(null)} onDrop={event=>{event.preventDefault();if(dragged&&droppable)propose(dragged,col);}}
      className={`flex min-w-0 flex-col overflow-hidden rounded-2xl border ${view==='board'?'w-[min(82vw,310px)] shrink-0':''} ${overCol===col.id?'border-brand-500 bg-brand-50 dark:bg-brand-500/10':'border-zinc-200 bg-zinc-100/60 dark:border-zinc-800 dark:bg-zinc-900/60'}`}>
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-zinc-200/70 p-3.5 dark:border-zinc-800"><div className="flex min-w-0 items-center gap-2"><span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{backgroundColor:col.color}} /><h2 className="text-sm font-semibold">{statusFa(col.name)}</h2><span className="badge-gray">{faNum(col.total)}</span></div>{!activeStatus&&<Link href={boardHref(query,{status:String(col.id),view:'overview'})} className="btn-ghost btn-sm text-xs">مشاهده همه <Icon name="chevron-left" size={13} /></Link>}</header>
      <div className={`${view==='board'?'min-h-0 flex-1 overflow-y-auto overscroll-contain':''} ${activeStatus&&view==='overview'?'grid sm:grid-cols-2 xl:grid-cols-3':'space-y-3'} gap-3 p-3`}>
       {shown.length?shown.map(card=>renderCard(card)):<p className="px-2 py-6 text-center text-xs leading-6 text-zinc-500">{col.total?'پذیرش‌های این مرحله در صفحه‌های دیگر قرار دارند. با «مشاهده همه» وارد این مرحله شوید.':'این مرحله فعلاً خالی است.'}</p>}
      </div>
      {col.total>shown.length&&!activeStatus&&<Link href={boardHref(query,{status:String(col.id),view:'overview'})} className="mx-3 mb-3 rounded-xl border border-dashed border-zinc-300 p-3 text-center text-xs font-medium text-brand-600 hover:border-brand-400 dark:border-zinc-700">نمایش همه {faNum(col.total)} پذیرش این مرحله</Link>}
     </section>;
    })}
   </div>
  </>}
  <Modal open={pending!==null} onClose={()=>{if(!busy)setPending(null);}} title="تأیید تغییر وضعیت">{pending&&<div className="space-y-4"><div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-700"><p className="font-mono text-sm font-bold">{pending.card.number}</p><p className="mt-1 text-sm">{pending.card.brand} {pending.card.model}</p><p className="mt-2 text-xs leading-6 text-zinc-500">از «{statusFa(pending.card.status_name)}» به «{statusFa(pending.status.name)}»</p></div><label className="block"><span className="label">یادداشت تغییر وضعیت (اختیاری)</span><textarea className="input" rows={3} disabled={busy} value={note} onChange={e=>setNote(e.target.value)} /></label>{error&&<p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}<div className="flex flex-wrap justify-end gap-2"><button className="btn-secondary" disabled={busy} onClick={()=>setPending(null)}>انصراف</button><button className="btn-primary" disabled={busy} onClick={()=>void commit()}>{busy?'در حال ثبت…':'ثبت تغییر وضعیت'}</button></div></div>}</Modal>
 </div>;
}
