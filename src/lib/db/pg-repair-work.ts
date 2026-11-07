import {HttpError} from '../http-error';
import {postgresRelation,type Scope} from './postgres-auth';
import {postgresDurableOperation} from './postgres-operations';
import {postgresRepairAccess} from './pg-repair-workflow';
import {pgId,pgRecord,pgText} from './pg-customer-finance';
import {safePostgresInteger,type PostgresDatabase} from './postgres';
import {requirePostgresIdentity} from './pg-app-auth';
import {statusFa} from '../status-fa';

export type RepairWorkKind='diagnosis'|'checklist'|'status'|'qc'|'start'|'time.start'|'time.stop'|'time.finish'|'time.manual';
export const repairWorkFields=['status_id','diagnosis','diagnosis_outcome','root_cause','checklist','qc_status','qc_notes','ready_at','completed_at','updated_at','work_version'] as const;
export function repairWorkProjection(alias:string){if(!/^[a-z]+$/.test(alias))throw Error('Internal repair alias required');return `jsonb_build_object(${repairWorkFields.map(key=>`'${key}',${alias}."${key}"`).join(',')})`;}
const permission=(kind:RepairWorkKind)=>kind==='diagnosis'||kind==='checklist'?'repairs.edit':kind==='status'||kind==='qc'||kind==='start'?'repairs.status':'repairs.notes';
const integer=(v:unknown)=>safePostgresInteger(v as string|number|bigint);
const technical=['Diagnosing','In Repair','Quality Control','Returned for Rework','Warranty'];
const keys:Record<RepairWorkKind,readonly string[]>={diagnosis:['diagnosis','diagnosis_outcome','root_cause'],checklist:['index','done'],status:['status','note'],qc:['result','notes'],start:['version','workflow_revision'],'time.start':['previous_entry_id'],'time.stop':['previous_entry_id'],'time.finish':['previous_entry_id'],'time.manual':['previous_entry_id','minutes','note']};
type Effects={statuses:number[];messages:number[];times:number[]};
type WorkResult={ok:boolean;ticket_id:number;work_id:number;work_version:number;id?:number;status?:string;timer_started?:boolean;running?:boolean;done?:boolean;minutes?:number};

export async function mutatePostgresRepairWork(db:PostgresDatabase,schema:string,token:string|undefined,branch:number|null,ticketId:number,kind:RepairWorkKind,input:unknown,key:string|null):Promise<WorkResult>{
 const t=(name:string)=>postgresRelation(schema,name),id=pgId(ticketId),b=pgRecord(input);
 if(!Object.hasOwn(keys,kind)||Object.keys(b).some(k=>k!=='expected_work_version'&&!keys[kind].includes(k)))throw new HttpError(400,'فرمان یا فیلد عملیات تعمیر معتبر نیست.');
 if(!Number.isSafeInteger(b.expected_work_version)||Number(b.expected_work_version)<0)throw new HttpError(400,'نسخهٔ پرونده مشخص نیست؛ صفحه را تازه کنید.');
 const initial=await postgresRepairAccess(db,schema,token,branch,id,{permission:permission(kind)}),target=integer(initial.ticket.branch_id);
 const authorize=async(scope:Scope)=>{if(kind==='start')await requirePostgresIdentity(db,schema,token,'repairs.notes',target);return postgresRepairAccess(db,schema,token,target,id,{permission:permission(kind),mutation:true,lock:true,scope});};
 return postgresDurableOperation(db,schema,token??'',{permission:permission(kind),branchId:target,operation:'repair.work.'+kind,key,payload:{ticket_id:id,...b},authorizeReplay:async scope=>{await authorize(scope);}},async scope=>{
  const access=await authorize(scope),ticket=access.ticket,version=integer(ticket.work_version);
  if(version!==b.expected_work_version)throw new HttpError(409,'پرونده تغییر کرده است؛ اطلاعات تازه را ببینید و دوباره اقدام کنید.');
  if((ticket.status_name==='Cancelled'||ticket.status_name==='Delivered'||ticket.delivered_at!=null)&&!['time.stop','time.finish'].includes(kind))throw new HttpError(409,'پروندهٔ بسته از مسیر اصلاح یا گارانتی بررسی می‌شود.');
  const assigned=String(ticket.technician_id)===String(scope.session.user.id)||String(ticket.technician2_id)===String(scope.session.user.id);
  if((kind==='start'||kind.startsWith('time.'))&&access.policy.mode!=='legacy'&&!assigned)throw new HttpError(403,'ثبت زمان فقط برای تعمیرکار ارجاع‌شده مجاز است.');
  if(kind==='start'&&access.policy.mode!=='legacy'&&(b.version!==integer(ticket.assignment_version)||b.workflow_revision!==access.policy.revision))throw new HttpError(409,'ارجاع یا مسیر تعمیر تغییر کرده است؛ کارتابل را تازه کنید.');
  const effects:Effects={statuses:[],messages:[],times:[]};
  const cmd=(await db.query(`INSERT INTO ${t('pg_repair_work_commands')}(ticket_id,branch_id,actor_id,kind,expected_version,before_json) SELECT id,branch_id,$2,$3,work_version,${repairWorkProjection('ticket')} FROM ${t('repair_tickets')} ticket WHERE id=$1 RETURNING id,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') now`,[id,scope.session.user.id,kind])).rows[0];
  const command=integer(cmd.id),now=String(cmd.now);await db.query(`SELECT set_config('repaid.work_id',$1,true),set_config('repaid.work_actor',$2,true)`,[String(command),String(scope.session.user.id)]);
  const update=async(fields:Record<string,unknown>)=>{const names=Object.keys(fields);await db.query(`UPDATE ${t('repair_tickets')} SET ${names.map((name,i)=>'"'+name+'"=$'+(i+1)).join(',')},updated_at=$${names.length+1} WHERE id=$${names.length+2}`,[...Object.values(fields),now,id]);};
  let current=String(ticket.status_name),result:Omit<WorkResult,'ticket_id'|'work_id'|'work_version'>={ok:true};
  const transition=async(name:string,note:string|null)=>{
   await requirePostgresIdentity(db,schema,token,'repairs.status',target);
   const states=(await db.query(`SELECT id,name,allowed_next,notify_customer FROM ${t('repair_statuses')} ORDER BY id LIMIT 1001`)).rows;if(states.length>1000)throw new HttpError(409,'فهرست وضعیت‌های تعمیر نیازمند بررسی است.');
   const from=states.find(r=>String(r.name)===current),to=states.find(r=>String(r.name).toLowerCase()===name.toLowerCase()||statusFa(String(r.name))===name);
   if(!from||!to)throw new HttpError(409,'وضعیت معتبر در گردش کار پیدا نشد.');
   if(from.id===to.id)return;
   if(['Delivered','Cancelled'].includes(String(to.name)))throw new HttpError(409,'تحویل یا لغو به یکپارچه‌سازی مالی اختصاصی نیاز دارد؛ این مسیر هنوز فعال نیست.');
   let allowed:unknown;try{allowed=JSON.parse(String(from.allowed_next??'[]'));}catch{throw new HttpError(409,'تعریف گردش کار نیازمند بررسی است.');}
   if(!Array.isArray(allowed)||!allowed.includes(to.name))throw new HttpError(409,'این انتقال وضعیت مجاز نیست؛ مرحلهٔ مجاز بعدی را انتخاب کنید.');
   if(access.policy.mode!=='legacy'&&['Diagnosing','In Repair','Quality Control'].includes(String(to.name))&&!(await db.query(`SELECT 1 FROM ${t('users')} u WHERE u.id=ANY($1::bigint[]) AND u.branch_id=$2 AND u.is_active=1 AND u.role='technician'`,[[ticket.technician_id,ticket.technician2_id].filter(v=>v!=null),target])).rowCount)throw new HttpError(409,'ابتدا تعمیرکار فعال همین شعبه را مشخص کنید.');
   const fields:Record<string,unknown>={status_id:to.id};if(to.name==='Ready for Pickup')fields.ready_at=now;if(['Unrepairable','No Fault Found'].includes(String(to.name)))fields.completed_at=now;await update(fields);
   const row=(await db.query(`INSERT INTO ${t('repair_status_history')}(ticket_id,from_status,to_status,user_id,note,work_command_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[id,from.id,to.id,scope.session.user.id,note,command])).rows[0];effects.statuses.push(integer(row.id));
   await db.query(`INSERT INTO ${t('customer_events')}(customer_id,ticket_id,type,title,detail,user_id,branch_id) VALUES($1,$2,'status',$3,$4,$5,$6)`,[ticket.customer_id,id,`Repair ${ticket.number}: ${to.name}`,note,scope.session.user.id,target]);
   if(Number(to.notify_customer)===1){
    const source=(await db.query(`SELECT c.first_name,c.last_name,d.brand,d.model FROM ${t('customers')} c JOIN ${t('devices')} d ON d.id=$2 AND d.customer_id=c.id WHERE c.id=$1`,[ticket.customer_id,ticket.device_id])).rows[0];if(!source)throw new HttpError(409,'ارتباط مشتری و دستگاه نیازمند بررسی است.');
    const template=(await db.query(`SELECT body,channel FROM ${t('message_templates')} WHERE event=$1 AND is_active=1 ORDER BY id LIMIT 1 FOR SHARE`,[to.name])).rows[0],settings=(await db.query(`SELECT key,value FROM ${t('settings')} WHERE key=ANY($1::text[])`,[['business_name','public_base_url']])).rows,map=new Map(settings.map(r=>[String(r.key),String(r.value)]));
    const variables:Record<string,string>={customer_name:[source.first_name,source.last_name].filter(Boolean).join(' '),ticket:String(ticket.number),device:[source.brand,source.model].filter(Boolean).join(' '),status:String(to.name),amount:'',link:(map.get('public_base_url')??'')+'/track/'+ticket.number,shop:map.get('business_name')??'RePaird'};
    const body=String(template?.body??'{{customer_name}} عزیز، وضعیت {{device}} شما (پذیرش {{ticket}}) به «{{status}}» تغییر کرد. پیگیری: {{link}} — {{shop}}').replace(/\{\{(\w+)\}\}/g,(_,key:string)=>variables[key]??'');
    if(body.length>10000||body.includes('\0'))throw new HttpError(409,'متن اعلان وضعیت معتبر نیست.');
    const message=(await db.query(`INSERT INTO ${t('messages')}(ticket_id,customer_id,direction,channel,body,status,user_id,work_command_id) VALUES($1,$2,'out',$3,$4,'queued',$5,$6) RETURNING id`,[id,ticket.customer_id,template?.channel??'sms',body,scope.session.user.id,command])).rows[0];effects.messages.push(integer(message.id));
   }
   current=String(to.name);
  };
  if(kind==='diagnosis'){
   const outcome=pgText(b.diagnosis_outcome,100),diagnosis=pgText(b.diagnosis,20000),cause=pgText(b.root_cause,10000);if(outcome&&!['repairable','not_repairable','no_fault_found','customer_declined','waiting_parts'].includes(outcome))throw new HttpError(400,'نتیجهٔ عیب‌یابی معتبر نیست.');await update({diagnosis,diagnosis_outcome:outcome,root_cause:cause});
  }else if(kind==='checklist'){
   if(!Number.isSafeInteger(b.index)||Number(b.index)<0||typeof b.done!=='boolean')throw new HttpError(400,'ردیف و نتیجهٔ چک‌لیست معتبر نیست.');
   let items:unknown;try{items=JSON.parse(String(ticket.checklist??'[]'));}catch{throw new HttpError(409,'چک‌لیست ذخیره‌شده نیازمند بررسی است.');}
   if(!Array.isArray(items)||items.length>1000||!items[Number(b.index)]||typeof items[Number(b.index)]!=='object'||Array.isArray(items[Number(b.index)]))throw new HttpError(400,'ردیف چک‌لیست وجود ندارد.');items[Number(b.index)]={...items[Number(b.index)],done:b.done};await update({checklist:JSON.stringify(items)});
  }else if(kind==='status'){await transition(pgText(b.status,160,true)!,pgText(b.note,1000));
  }else if(kind==='qc'){
   if(!['pass','fail'].includes(String(b.result)))throw new HttpError(400,'نتیجهٔ کنترل کیفیت معتبر نیست.');if(current!=='Quality Control')throw new HttpError(409,'پرونده باید در مرحلهٔ کنترل کیفیت باشد.');await update({qc_status:b.result==='pass'?'passed':'failed',qc_notes:pgText(b.notes,10000)});await transition(b.result==='pass'?'Ready for Pickup':'In Repair',b.result==='pass'?'کنترل کیفیت قبول':'کنترل کیفیت رد شد — بازگشت برای اصلاح');
  }else{
   const prior=(await db.query(`SELECT COALESCE(MAX(id),0) id FROM ${t('time_entries')} WHERE ticket_id=$1 AND user_id=$2`,[id,scope.session.user.id])).rows[0];
   if(b.previous_entry_id!=null&&b.previous_entry_id!==integer(prior.id))throw new HttpError(409,'زمان‌سنج تغییر کرده است؛ اطلاعات را تازه کنید.');
   const open=(await db.query(`SELECT * FROM ${t('time_entries')} WHERE ticket_id=$1 AND user_id=$2 AND ended_at IS NULL ORDER BY id LIMIT 2 FOR UPDATE`,[id,scope.session.user.id])).rows;if(open.length>1)throw new HttpError(409,'زمان‌سنج‌های قدیمیِ هم‌زمان نیازمند بررسی‌اند.');
   if(kind==='start'||kind==='time.start'){
    if(kind==='start'||access.policy.mode!=='legacy'){
     if(!assigned){let authority=false;try{await requirePostgresIdentity(db,schema,token,'repairs.assign',target);authority=true;}catch(error){if(!(error instanceof HttpError))throw error;}if(!authority)throw new HttpError(403,'این دستگاه به شما ارجاع نشده است.');}
     if(access.policy.mode!=='legacy'){
      if(current==='New')await transition('Received','دریافت دستگاه ارجاع‌شده توسط تعمیرکار');
      const state=(await db.query(`SELECT allowed_next FROM ${t('repair_statuses')} WHERE name=$1`,[current])).rows[0];let next:unknown;try{next=JSON.parse(String(state?.allowed_next??'[]'));}catch{throw new HttpError(409,'تعریف گردش کار معتبر نیست.');}
      if(Array.isArray(next)&&next.includes('Diagnosing'))await transition('Diagnosing','شروع کار از کارتابل');else if(!technical.includes(current))throw new HttpError(409,'شروع کار در وضعیت فعلی مجاز نیست.');
     }else await transition('In Repair','شروع کار از کارتابل');
    }
    if(!open.length){const row=(await db.query(`INSERT INTO ${t('time_entries')}(ticket_id,user_id,started_at,work_created_id) VALUES($1,$2,$3,$4) RETURNING id`,[id,scope.session.user.id,now,command])).rows[0];effects.times.push(integer(row.id));result={...result,id:integer(row.id),timer_started:true};}else{if(kind==='time.start'&&access.policy.mode==='legacy')throw new HttpError(409,'زمان‌سنج این پذیرش باز است.');result={...result,id:integer(open[0].id),timer_started:false};}result={...result,status:current,running:true};
   }else if(kind==='time.stop'||kind==='time.finish'){
    if(!open.length)throw new HttpError(409,'زمان‌سنج بازی وجود ندارد.');const raw=String(open[0].started_at),started=Date.parse(/[zZ]|[+-]\d\d(?::?\d\d)?$/.test(raw)?raw:raw.replace(' ','T')+'Z'),end=Date.parse(now);if(!Number.isFinite(started)||started>end)throw new HttpError(409,'زمان شروع نیازمند بررسی است.');const minutes=Math.max(1,Math.round((end-started)/60000));if(!Number.isSafeInteger(minutes))throw new HttpError(409,'مدت کار خارج از محدودهٔ مجاز است.');await db.query(`UPDATE ${t('time_entries')} SET ended_at=$1,minutes_active=$2,work_closed_id=$3 WHERE id=$4`,[now,minutes,command,open[0].id]);effects.times.push(integer(open[0].id));result={...result,done:true,minutes};
   }else if(kind==='time.manual'){
    if(!Number.isSafeInteger(b.minutes)||Number(b.minutes)<=0)throw new HttpError(400,'دقیقهٔ کار باید عدد صحیح مثبت باشد.');const row=(await db.query(`INSERT INTO ${t('time_entries')}(ticket_id,user_id,started_at,ended_at,minutes_active,is_manual,note,work_created_id,work_closed_id) VALUES($1,$2,$3,$3,$4,1,$5,$6,$6) RETURNING id`,[id,scope.session.user.id,now,b.minutes,pgText(b.note,10000),command])).rows[0];effects.times.push(integer(row.id));result={...result,id:integer(row.id),minutes:Number(b.minutes)};
   }
  }
  await update({work_version:version+1});await db.query(`UPDATE ${t('pg_repair_work_commands')} SET after_json=(SELECT ${repairWorkProjection('ticket')} FROM ${t('repair_tickets')} ticket WHERE id=$1),effects_json=$2 WHERE id=$3`,[id,JSON.stringify(effects),command]);
  return {...result,ticket_id:id,work_id:command,work_version:version+1};
 });
}

export async function readPostgresRepairTime(db:PostgresDatabase,schema:string,token:string|undefined,branch:number|null,id:number,page=1){
 if(!Number.isSafeInteger(page)||page<1||page>100000)throw new HttpError(400,'صفحه معتبر نیست.');
 return db.transaction(async()=>{const {scope,ticket,policy}=await postgresRepairAccess(db,schema,token,branch,pgId(id)),t=(name:string)=>postgresRelation(schema,name),entries=(await db.query(`SELECT e.*,u.name user_name FROM ${t('time_entries')} e LEFT JOIN ${t('users')} u ON u.id=e.user_id WHERE e.ticket_id=$1 ORDER BY e.id DESC LIMIT 50 OFFSET $2`,[id,(page-1)*50])).rows;
  const totals=(await db.query(`SELECT COUNT(*) n,COALESCE(SUM(minutes_active),0) minutes FROM ${t('time_entries')} WHERE ticket_id=$1`,[id])).rows[0],running=(await db.query(`SELECT * FROM ${t('time_entries')} WHERE ticket_id=$1 AND user_id=$2 AND ended_at IS NULL ORDER BY id DESC LIMIT 2`,[id,scope.session.user.id])).rows,last=(await db.query(`SELECT COALESCE(MAX(id),0) id FROM ${t('time_entries')} WHERE ticket_id=$1 AND user_id=$2`,[id,scope.session.user.id])).rows[0];if(running.length>1)throw new HttpError(409,'زمان‌سنج‌های قدیمی نیازمند بررسی‌اند.');
  const map=(r:Record<string,unknown>)=>({...r,id:integer(r.id),ticket_id:integer(r.ticket_id),user_id:r.user_id==null?null:integer(r.user_id),minutes_active:r.minutes_active==null?null:integer(r.minutes_active),is_manual:r.is_manual==null?0:integer(r.is_manual)});
  return {entries:entries.map(map),totalMinutes:integer(totals.minutes),running:running[0]?map(running[0]):null,lastEntryId:integer(last.id),work_version:integer(ticket.work_version),assignment_version:integer(ticket.assignment_version),workflow_revision:policy.revision,page,total:integer(totals.n),totalPages:Math.max(1,Math.ceil(integer(totals.n)/50))};
 },{isolation:'repeatable read'});
}
