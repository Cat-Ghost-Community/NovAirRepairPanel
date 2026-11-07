import {createPostgresDatabase} from '../../src/lib/db/postgres';
import {postgresMutateBank} from '../../src/lib/db/postgres-bank';
import type {BankInput} from '../../src/lib/bank-input';
const url=process.env.REPAID_PG_TEST_URL??'',database=process.env.REPAID_PG_TEST_DATABASE??'';
if(!process.send||!/^repaid_test_[a-f0-9]{24}$/.test(database)||new URL(url).pathname!=='/'+database)throw new Error('Isolated PostgreSQL banking IPC worker required');
const db=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true});
const timeout=setTimeout(()=>{process.exitCode=1;process.disconnect?.();void db.close();},15000);
process.once('message',async({schema,token,key,body,interrupt}:{schema:string;token:string;key:string;body:BankInput;interrupt:boolean})=>{
 try{const result=await db.transaction(async()=>{const result=await postgresMutateBank(db,schema,token,key,body);if(interrupt){process.send?.({mutated:true});await new Promise(()=>{});}return result;});process.send?.(result);}
 catch(error){process.send?.({error:(error as Error).message});process.exitCode=1;}
 finally{clearTimeout(timeout);await db.close();process.disconnect?.();}
});process.send({ready:true});
