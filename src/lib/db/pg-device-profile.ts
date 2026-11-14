import {deviceProfileChanges} from '../device-profile';
import {readPostgresDeviceCatalog} from './pg-device-catalog';
import {pgId,pgRecord,postgresFinancialAudit,scopeFor} from './pg-customer-finance';
import {postgresDurableOperation} from './postgres-operations';
import {postgresRelation} from './postgres-auth';
import type {PostgresDatabase} from './postgres';
import {HttpError} from '../http-error';

export async function updatePostgresDevice(db:PostgresDatabase,schema:string,token:string|undefined,branch:number|null,id:number,payload:unknown,key:string|null){
 pgId(id);const body=pgRecord(payload),target=await scopeFor(db,schema,token,'devices.edit',branch,{table:'devices',id}),table=postgresRelation(schema,'devices');
 return postgresDurableOperation(db,schema,token??'',{permission:'devices.edit',branchId:target,operation:'device.profile',key,payload},async scope=>{
  const before=(await db.query(`SELECT * FROM ${table} WHERE id=$1 AND is_archived=0 FOR UPDATE`,[id])).rows[0];
  if(!before)throw new HttpError(404,'دستگاه یافت نشد.');
  if(Object.hasOwn(body,'expected_updated_at')&&body.expected_updated_at!==(before.updated_at??null))throw new HttpError(409,'مشخصات دستگاه تغییر کرده است؛ دوباره باز کنید.');
  const changes=deviceProfileChanges(await readPostgresDeviceCatalog(db,schema),before,body);
  changes.updated_at=new Date().toISOString();const fields=Object.keys(changes);
  await db.query(`UPDATE ${table} SET ${fields.map((field,index)=>'"'+field+'"=$'+(index+1)).join(',')} WHERE id=$${fields.length+1}`,[...Object.values(changes),id]);
  await postgresFinancialAudit(db,schema,scope,'update','device',id,{before,changes});
  return {ok:true,id};
 });
}
