import {createPostgresDatabase} from '../../src/lib/db/postgres';
import {mutatePostgresRepairWork} from '../../src/lib/db/pg-repair-work';
async function main(){
 const url=process.env.REPAID_PG_TEST_URL??'',database=process.env.REPAID_PG_TEST_DATABASE??'';
 if(!/^repaid_test_[a-f0-9]{24}$/.test(database)||new URL(url).pathname!=='/'+database)throw Error('Disposable database required');
 let raw='';for await(const chunk of process.stdin){raw+=String(chunk);if(raw.length>20000)throw Error('Fixture too large');}
 const fixture=JSON.parse(raw) as {schema:string;token:string;id:number;key:string},db=createPostgresDatabase({connectionString:url,allowLocalPlaintext:true,maxConnections:2});
 try{const result=await mutatePostgresRepairWork(db,fixture.schema,fixture.token,1,fixture.id,'time.manual',{expected_work_version:0,minutes:23,note:'Independent process labor'},fixture.key);process.stdout.write(JSON.stringify({ok:true,result}));}
 catch(error){const e=error as {status?:number;code?:string};process.stdout.write(JSON.stringify({ok:false,status:e.status??null,code:e.code??null}));}
 finally{await db.close();}
}
main().catch(()=>{process.stderr.write('Independent repair worker failed');process.exitCode=1;});
