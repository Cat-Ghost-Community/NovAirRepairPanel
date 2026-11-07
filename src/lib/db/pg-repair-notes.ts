import {HttpError} from '../http-error';
import {postgresRelation,type Scope} from './postgres-auth';
import {postgresDurableOperation} from './postgres-operations';
import {pgId,pgRecord} from './pg-customer-finance';
import {safePostgresInteger,type PostgresDatabase} from './postgres';
import {postgresRepairAccess,postgresRepairAssignedOnly} from './pg-repair-workflow';

export const REPAIR_NOTE_KINDS=['private','internal','public'] as const;
type NoteKind=typeof REPAIR_NOTE_KINDS[number];
export type PostgresRepairNote={id:number;ticket_id:number;user_id:number|null;body:string;kind:string;created_at:string|null;branch_id:number|null;user_name:string|null};
function text(input:unknown,max:number,empty=false){if(typeof input!=='string'||input.includes('\0')||input.length>max||!empty&&!input.trim())throw new HttpError(400,'متن شرح کار معتبر نیست؛ متن غیرخالی و حداکثر ده‌هزار نویسه وارد کنید.');return input.trim();}
function persistedId(value:unknown){if(typeof value!=='string'&&typeof value!=='number'&&typeof value!=='bigint')throw new HttpError(409,'شناسهٔ سابقهٔ شرح کار نیازمند بررسی است.');return safePostgresInteger(value);}
function note(raw:Record<string,unknown>):PostgresRepairNote{return {id:persistedId(raw.id),ticket_id:persistedId(raw.ticket_id),user_id:raw.user_id==null?null:persistedId(raw.user_id),body:String(raw.body),kind:String(raw.kind),created_at:raw.created_at==null?null:String(raw.created_at),branch_id:raw.branch_id==null?null:persistedId(raw.branch_id),user_name:raw.user_name==null?null:String(raw.user_name)};}

export class PostgresRepairNotes {
 constructor(readonly db:PostgresDatabase,readonly schema:string){}
 q(name:string){return postgresRelation(this.schema,name);}
 async canWrite(token:string|undefined,branch:number|null,ticketId:number){try{await this.db.transaction(()=>postgresRepairAccess(this.db,this.schema,token,branch,pgId(ticketId),{permission:'repairs.notes',mutation:true}));return true;}catch(error){if(error instanceof HttpError&&[403,404].includes(error.status))return false;throw error;}}
 async create(token:string|undefined,branch:number|null,ticketId:number,input:unknown,key:string|null){
  const id=pgId(ticketId),b=pgRecord(input);if(Object.keys(b).some(k=>!['body','kind'].includes(k)))throw new HttpError(400,'فیلد ناشناخته در شرح کار ارسال شده است.');const body=text(b.body,10000),kind=b.kind??'internal';if(!REPAIR_NOTE_KINDS.includes(kind as NoteKind))throw new HttpError(400,'نوع شرح کار معتبر نیست.');
  const initial=await postgresRepairAccess(this.db,this.schema,token,branch,id,{permission:'repairs.notes'}),target=safePostgresInteger(initial.ticket.branch_id);
  const authorize=async(scope:Scope)=>postgresRepairAccess(this.db,this.schema,token,target,id,{permission:'repairs.notes',mutation:true,lock:true,scope});
  return postgresDurableOperation(this.db,this.schema,token??'',{permission:'repairs.notes',branchId:target,operation:'repair.note.create',key,payload:{ticket_id:id,body,kind},authorizeReplay:async(scope,result:{id:number;ticket_id:number;ok:true})=>{await authorize(scope);const saved=(await this.db.query(`SELECT id,user_id,kind,body FROM ${this.q('repair_notes')} WHERE id=$1 AND ticket_id=$2 AND branch_id=$3`,[result.id,id,target])).rows[0];if(!saved||safePostgresInteger(saved.user_id)!==scope.session.user.id||saved.body!==body||saved.kind!==kind)throw new HttpError(409,'سابقه شرح کار تغییر کرده است؛ نتیجه نیازمند بررسی است.');}},async actor=>{await authorize(actor);await this.db.query(`SELECT set_config('repaid.repair_note_actor',$1,true)`,[String(actor.session.user.id)]);const saved=(await this.db.query(`INSERT INTO ${this.q('repair_notes')}(ticket_id,user_id,body,kind,created_at,branch_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[id,actor.session.user.id,body,kind,new Date().toISOString(),target])).rows[0];return {ok:true as const,id:safePostgresInteger(saved.id),ticket_id:id};});
 }
 async list(token:string|undefined,branch:number|null,ticketId:number,options:{q?:string;page?:number;perPage?:number;similar?:boolean}={}){
  const id=pgId(ticketId),page=options.page??1,perPage=options.perPage??20,query=text(options.q??'',200,true),similar=options.similar??options.q!=null;if(!Number.isSafeInteger(page)||page<1||page>100000||!Number.isSafeInteger(perPage)||perPage<1||perPage>100||typeof similar!=='boolean')throw new HttpError(400,'صفحه‌بندی شرح کار معتبر نیست.');
  return this.db.transaction(async()=>{const access=await postgresRepairAccess(this.db,this.schema,token,branch,id,{permission:'repairs.view'}),actor=access.scope,privileged=['owner','admin','manager'].includes(actor.session.user.role),assigned=await postgresRepairAssignedOnly(this.db,this.schema,actor,safePostgresInteger(access.ticket.branch_id),{mutation:false});
   if(similar&&query.length<3)return {notes:[],total:0,page,perPage,totalPages:1,hasMore:false};
   const from=`FROM ${this.q('repair_notes')} n JOIN ${this.q('repair_tickets')} t ON t.id=n.ticket_id LEFT JOIN ${this.q('users')} u ON u.id=n.user_id JOIN ${this.q('devices')} d ON d.id=t.device_id`,where=`($1::bigint IS NULL OR t.branch_id=$1) AND (n.branch_id IS NULL OR n.branch_id=t.branch_id) AND (NOT $2::boolean OR t.technician_id=$3 OR t.technician2_id=$3) AND (n.kind IN ('internal','public') OR n.kind='private' AND (n.user_id=$3 OR $6::boolean)) AND ${similar?`n.ticket_id<>$4 AND n.kind IN ('internal','public') AND (n.body ILIKE '%'||$5||'%' OR t.problem ILIKE '%'||$5||'%')`:`n.ticket_id=$4 AND ($5='' OR n.body ILIKE '%'||$5||'%')`}`,args=[actor.branchId,assigned,actor.session.user.id,id,query,privileged],total=safePostgresInteger((await this.db.query(`SELECT COUNT(*) n ${from} WHERE ${where}`,args)).rows[0].n),rows=(await this.db.query(`SELECT n.*,u.name user_name,u.name author,t.number ticket_number,d.brand,d.model ${from} WHERE ${where} ORDER BY n.created_at DESC NULLS LAST,n.id DESC LIMIT $7 OFFSET $8`,[...args,perPage,(page-1)*perPage])).rows;
   return {notes:rows.map(r=>({...note(r),author:r.author==null?null:String(r.author),ticket_number:String(r.ticket_number),brand:r.brand==null?null:String(r.brand),model:r.model==null?null:String(r.model)})),total,page,perPage,totalPages:Math.max(1,Math.ceil(total/perPage)),hasMore:page*perPage<total};
  },{isolation:'repeatable read'});
 }
}
