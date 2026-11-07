import {DatabaseSync} from 'node:sqlite';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const filename=fs.realpathSync(process.argv[2]??''),directory=path.dirname(filename);if(path.dirname(directory)!==fs.realpathSync(os.tmpdir())||!path.basename(directory).startsWith('repaid-contention-')||!process.send)throw new Error('Isolated IPC contention fixture required');
const db=new DatabaseSync(filename);db.exec('PRAGMA busy_timeout=1000;BEGIN IMMEDIATE;UPDATE balances SET amount=amount+7 WHERE id=1');
const timeout=setTimeout(()=>{if(db.isTransaction)db.exec('ROLLBACK');db.close();process.exitCode=1;process.disconnect?.();},10000);
process.on('message',message=>{if(message!=='release')return;clearTimeout(timeout);db.exec('COMMIT');db.close();process.disconnect?.();});process.on('disconnect',()=>clearTimeout(timeout));process.send({locked:true});
