import {createPostgresDatabase} from '../../src/lib/db/postgres';
import {createPostgresInvoice} from '../../src/lib/db/pg-customer-finance';
const url=process.env.REPAID_PG_TEST_URL??'',name=process.env.REPAID_PG_TEST_DATABASE??'';
if(!process.send||!/^repaid_test_[a-f0-9]{24}$/.test(name)||new URL(url).pathname!=='/'+name)throw Error('Disposable PostgreSQL invoice worker required');
const db=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true});
const timeout=setTimeout(()=>{process.exitCode=1;process.disconnect?.();void db.close();},15000);
process.once('message',async({schema,token,key,ticket}:{schema:string;token:string;key:string;ticket:number})=>{
 try{if(!/^repaid_integration_[a-f0-9]{24}$/.test(schema))throw Error('Isolated schema required');process.send?.(await createPostgresInvoice(db,schema,token,1,{type:'repair',customer_id:1,ticket_id:ticket,items:[{kind:'labor',name:'Documented source service',qty:1,unit_price:1000}],confirm:true},key));}
 catch(error){process.send?.({error:(error as Error).message});process.exitCode=1;}
 finally{clearTimeout(timeout);await db.close();process.disconnect?.();}
});process.send({ready:true});
