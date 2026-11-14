import {it,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {documentNumber,validDocumentAffix} from '../src/lib/document-number';
import {requireReceptionCustomerName} from '../src/lib/reception-validation';
import {CUSTOMER_TYPES,customerTypeFa,customerTypeValue} from '../src/lib/customer-type';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'novair-numbering-'));
process.env.REPAID_DATA_DIR=directory;process.env.REPAID_DEMO_MODE='0';
let db:ReturnType<typeof import('../src/lib/db/schema').getDb>,next:typeof import('../src/lib/db/schema').nextSeq;
before(async()=>{const schema=await import('../src/lib/db/schema');db=schema.getDb();next=schema.nextSeq;});
after(()=>{db?.close();const root=fs.realpathSync(directory);assert.equal(path.dirname(root),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(root).startsWith('novair-numbering-'));fs.rmSync(root,{recursive:true,force:true});});
it('requires only surname for reception while keeping supplied names type-safe',()=>{
 for(const last_name of [undefined,null,'','  ',42])assert.throws(()=>requireReceptionCustomerName({first_name:'علی',last_name}),{status:400});
 for(const first_name of [undefined,null,'',' ','علی'])assert.doesNotThrow(()=>requireReceptionCustomerName({first_name,last_name:'رضایی'}));
 for(const first_name of [42,{},[]])assert.throws(()=>requireReceptionCustomerName({first_name,last_name:'رضایی'}),{status:400});
 assert.doesNotThrow(()=>requireReceptionCustomerName({first_name:'علی',last_name:'رضایی'}));
});
it('removes the novice option while preserving neutral display of legacy records',()=>{
 assert.ok(!CUSTOMER_TYPES.includes('new' as never));assert.equal(customerTypeValue('new'),'regular');assert.equal(customerTypeFa('new'),'مشتری عادی');assert.equal(customerTypeValue('colleague'),'colleague');assert.equal(customerTypeValue('invalid'),null);
});
it('formats defaults, configured prefixes, suffixes, empty prefixes and extended counters exactly',()=>{
 assert.equal(documentNumber('ticket','R',2),'R0002');assert.equal(documentNumber('ticket','R',2,4,{ticket_prefix:'RP-',ticket_suffix:'-A'}),'RP-0002-A');
 assert.equal(documentNumber('invoice:sale','SINV-',17,4,{invoice_prefix:'F-',invoice_suffix:'-1405'}),'F-0017-1405');
 assert.equal(documentNumber('ticket','R',10001,4,{ticket_prefix:''}),'10001');assert.equal(documentNumber('payment','PMT-',2,4,{ticket_suffix:'-A'}),'PMT-0002');
 for(const invalid of ['../','a/b','a?x','a\n','x'.repeat(33)])assert.equal(validDocumentAffix(invalid),false);assert.equal(validDocumentAffix('پذیرش-'),true);
});
it('reads saved settings for each real SQLite issue without resetting counters or renumbering history',()=>{
 const first=next('ticket','R');assert.equal(first,'R0001');
 db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('ticket_prefix','RP-');db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('ticket_suffix','-B');
 assert.equal(next('ticket','R'),'RP-0002-B');db.prepare("UPDATE settings SET value='-C' WHERE key='ticket_suffix'").run();assert.equal(next('ticket','R'),'RP-0003-C');assert.equal(first,'R0001');
 db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('invoice_prefix','F-');db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('invoice_suffix','-A');assert.equal(next('invoice','INV-'),'F-0001-A');assert.equal(next('invoice','SINV-'),'F-0002-A');assert.equal(next('customer','C'),'C0001');
});
