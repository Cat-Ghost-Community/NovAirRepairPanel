import {createPostgresDatabase} from '../../src/lib/db/postgres';
import {postgresDurableOperation} from '../../src/lib/db/postgres-operations';
import {postgresCreateManualJournal,postgresPostManualJournal} from '../../src/lib/db/postgres-journals';
const url=process.env.REPAID_PG_TEST_URL??'',database=process.env.REPAID_PG_TEST_DATABASE??'';
if(!process.send||!/^repaid_test_[a-f0-9]{24}$/.test(database)||new URL(url).pathname!=='/'+database)throw new Error('Isolated PostgreSQL IPC test worker required');
const db=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true});
const timeout=setTimeout(()=>{process.exitCode=1;process.disconnect?.();void db.close();},15000);
process.once('message',async({schema,token,key,interrupt}:{schema:string;token:string;key:string;interrupt:boolean})=>{
  try{const result=await postgresDurableOperation(db,schema,token,{permission:'finance.manage',branchId:1,operation:'manual_post',key,payload:{amount:23},scope:'business'},async()=>{
    const draft=await postgresCreateManualJournal(db,schema,token,{branch_id:1,posting_date:'2026-10-30',source_type:'manual',source_id:key,event_key:key,memo:'Documented manual operation',lines:[{account_code:'1000',debit:23},{account_code:'4010',credit:23}]});
    await postgresPostManualJournal(db,schema,token,draft.id,{expectedHash:draft.request_hash});
    if(interrupt){process.send?.({mutated:true});await new Promise(()=>{});}
    return {id:draft.id,amount:23};
  });process.send?.(result);
  }catch(error){process.send?.({error:String((error as Error).message)});process.exitCode=1;}
  finally{clearTimeout(timeout);await db.close();process.disconnect?.();}
});process.send({ready:true});
