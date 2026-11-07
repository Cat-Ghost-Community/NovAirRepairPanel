import {createPostgresDatabase} from '../../src/lib/db/postgres';
import {postgresCreateManualJournal,postgresPostManualJournal} from '../../src/lib/db/postgres-journals';
import type {JournalInput} from '../../src/lib/journal-input';
const url=process.env.REPAID_PG_TEST_URL??'',name=process.env.REPAID_PG_TEST_DATABASE??'';if(!process.send||!/^repaid_test_[a-f0-9]{24}$/.test(name)||new URL(url).pathname!=='/'+name)throw new Error('Isolated PostgreSQL IPC worker required');
const db=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true});const timeout=setTimeout(async()=>{await db.close();process.exitCode=1;process.disconnect?.();},10000);
process.once('message',async(message:{schema:string;token:string;input:JournalInput})=>{clearTimeout(timeout);try{const draft=await postgresCreateManualJournal(db,message.schema,message.token,message.input),posted=await postgresPostManualJournal(db,message.schema,message.token,draft.id,{expectedHash:draft.request_hash});process.send?.({id:draft.id,duplicate:posted.duplicate});}catch{process.exitCode=1;}finally{await db.close();process.disconnect?.();}});process.send({ready:true});
