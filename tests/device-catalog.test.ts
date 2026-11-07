import {before,after,it} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {defaultDeviceCatalog,validateDeviceCatalog,reviseDeviceCatalog,validateDeviceRegistration,deviceRegistrationSpecs,deviceFormPayload,customDeviceSpecs,parseDeviceCatalog,deviceTypeLabel} from '../src/lib/device-catalog';
import {tehranGreeting} from '../src/lib/tehran-greeting';
import {readDeviceCatalog,saveDeviceCatalog,deviceTypeFacets} from '../src/lib/device-catalog-store';
import type {Session} from '../src/lib/auth';
import {insertRegisteredDevice} from '../src/lib/device-registration';
import {atomic} from '../src/lib/db/transaction';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'novair-catalog-'));process.env.REPAID_DATA_DIR=root;process.env.REPAID_DEMO_MODE='0';
let db:ReturnType<typeof import('../src/lib/db/schema').getDb>;
const owner={user:{id:1,role:'owner',branch_id:1}} as Session,staff={user:{id:2,role:'admin',branch_id:1}} as Session;
before(async()=>{db=(await import('../src/lib/db/schema')).getDb();db.exec("INSERT INTO branches(id,name,code) VALUES(1,'One','ONE'),(2,'Two','TWO');INSERT INTO users(id,name,email,password_hash,role,branch_id) VALUES(1,'Owner','catalog@local.invalid','unused','owner',1),(2,'Admin','staff@local.invalid','unused','admin',1);INSERT INTO customers(id,first_name,last_name,branch_id) VALUES(1,'First','Customer',1),(2,'Second','Customer',2);INSERT INTO devices(id,customer_id,type,brand,model,branch_id,is_archived) VALUES(1,1,'mobile','A','B',1,0),(2,2,'console','C','D',2,0),(3,1,'printer','E','F',1,1)");});
after(()=>{db?.close();const resolved=fs.realpathSync(root);assert.equal(path.dirname(resolved),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('novair-catalog-'));fs.rmSync(resolved,{recursive:true,force:true});});
it('uses Tehran day-period boundaries, midnight and current no-DST summer rules independently of host timezone',()=>{
 const cases=[['2026-11-08T00:29:00Z','شب بخیر'],['2026-11-08T01:30:00Z','صبح بخیر'],['2026-11-08T08:29:00Z','صبح بخیر'],['2026-11-08T08:30:00Z','بعدازظهر بخیر'],['2026-11-08T13:30:00Z','عصر بخیر'],['2026-11-08T16:30:00Z','شب بخیر'],['2026-11-08T20:31:00Z','شب بخیر'],['2026-07-08T08:30:00Z','بعدازظهر بخیر']];
 const original=process.env.TZ;try{for(const zone of ['UTC','America/New_York','Asia/Tokyo']){process.env.TZ=zone;for(const [date,expected] of cases)assert.equal(tehranGreeting(new Date(date)),expected);}}finally{if(original==null)delete process.env.TZ;else process.env.TZ=original;}
});
it('keeps existing built-in types and required model fields as defaults, failing closed on corrupt saved configuration',()=>{
 const catalog=defaultDeviceCatalog();assert.equal(catalog.types.length,9);assert.doesNotThrow(()=>validateDeviceCatalog(catalog));assert.throws(()=>validateDeviceRegistration(catalog,'mobile',{brand:'A'}),{status:400});assert.throws(()=>parseDeviceCatalog('invalid JSON'),{status:503});
});
it('validates type-specific required values, options, exact dates, numeric bounds and checkbox confirmation',()=>{
 const catalog=defaultDeviceCatalog();catalog.types.push({id:'industrial',label:'تجهیز صنعتی',icon:'plug',active:true,fields:[{id:'custom_voltage',label:'ولتاژ',kind:'number',required:true},{id:'custom_mode',label:'حالت',kind:'select',required:true,options:['AC','DC']},{id:'custom_date',label:'تاریخ',kind:'date',required:true},{id:'custom_check',label:'تأیید',kind:'checkbox',required:true}]});
 const body={custom_fields:{custom_voltage:'220.5',custom_mode:'AC',custom_date:'2026-02-28',custom_check:'true'}};
 assert.equal(Object.keys(deviceRegistrationSpecs(catalog,'industrial',body)).length,4);
 for(const patch of [{custom_voltage:'not-a-number'},{custom_mode:'illegal'},{custom_date:'2026-02-30'},{custom_check:'false'},{custom_voltage:''},{custom_foreign:'x'}])assert.throws(()=>deviceRegistrationSpecs(catalog,'industrial',{custom_fields:{...body.custom_fields,...patch}}),{status:400});
 assert.throws(()=>validateDeviceRegistration(catalog,'mobile',{brand:'A',model:'B',battery_health:101}),{status:400});
 const recorded=deviceRegistrationSpecs(catalog,'industrial',body);catalog.types.at(-1)!.fields[0].label='عنوان جدید';assert.equal(customDeviceSpecs(JSON.stringify(recorded))[0].label,'ولتاژ');
 const payload=deviceFormPayload(catalog,'industrial',{brand:'hidden',custom_fields:{...body.custom_fields,custom_foreign:'drop'}});assert.equal(payload.brand,undefined);assert.equal(Object.hasOwn(payload.custom_fields,'custom_foreign'),false);
});
it('rejects duplicate identities, reserved custom keys, oversized definitions and stale revisions; retirement preserves history labels',()=>{
 const catalog=defaultDeviceCatalog();for(const mutate of [(c:typeof catalog)=>c.types.push(c.types[0]),(c:typeof catalog)=>{c.types[0].fields.push({id:'customer_id',label:'bad',kind:'text',required:false});},(c:typeof catalog)=>{c.types.forEach(t=>t.active=false);}]){const invalid=structuredClone(catalog);mutate(invalid);assert.throws(()=>validateDeviceCatalog(invalid),{status:400});}
 const proposed=structuredClone(catalog);proposed.types=proposed.types.filter(t=>t.id!=='console');const next=reviseDeviceCatalog(catalog,proposed);assert.equal(next.types.find(t=>t.id==='console')!.active,false);assert.equal(deviceTypeLabel(next,'console'),'کنسول بازی');assert.throws(()=>validateDeviceRegistration(next,'console',{brand:'A',model:'B'}),{status:400});assert.throws(()=>reviseDeviceCatalog(next,proposed),{status:409});
});
it('limits category facets to active records in the authorized branch, restoring a filter when a device is registered',()=>{
 assert.deepEqual(deviceTypeFacets(db,1),[{id:'mobile',count:1}]);assert.deepEqual(deviceTypeFacets(db,2),[{id:'console',count:1}]);assert.equal(deviceTypeFacets(db,null).length,2);
 db.exec("INSERT INTO devices(customer_id,type,branch_id) VALUES(1,'laptop',1)");assert.ok(deviceTypeFacets(db,1).some(f=>f.id==='laptop'));db.exec("UPDATE devices SET is_archived=1 WHERE type='laptop'");assert.ok(!deviceTypeFacets(db,1).some(f=>f.id==='laptop'));
});
it('requires the company owner, persists audited versions and rolls catalog changes back on audit failure',()=>{
 const initial=readDeviceCatalog(db);assert.throws(()=>saveDeviceCatalog(db,staff,initial),{status:403});const changed=structuredClone(initial);changed.types[0].label='گوشی';const saved=saveDeviceCatalog(db,owner,changed);assert.equal(saved.revision,1);assert.equal(readDeviceCatalog(db).types[0].label,'گوشی');assert.throws(()=>saveDeviceCatalog(db,owner,changed),{status:409});
 db.exec("CREATE TRIGGER catalog_failure BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'injected catalog audit failure');END");const next=structuredClone(saved);next.types[0].active=false;assert.throws(()=>saveDeviceCatalog(db,owner,next),/injected/);assert.equal(readDeviceCatalog(db).revision,1);assert.equal(readDeviceCatalog(db).types[0].active,true);db.exec('DROP TRIGGER catalog_failure');assert.equal(saveDeviceCatalog(db,owner,next).revision,2);assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity='device_catalog'").get()!.n,2);
});
it('normal and bulk creation share policy validation, persist custom values and roll an invalid batch back',()=>{
 const catalog=readDeviceCatalog(db);catalog.types.push({id:'industrial',label:'صنعتی',icon:'plug',active:true,fields:[{id:'custom_power',label:'توان',kind:'number',required:true}]});saveDeviceCatalog(db,owner,catalog);
 const before=Number(db.prepare('SELECT COUNT(*) n FROM devices').get()!.n);
 assert.throws(()=>atomic(db,()=>{insertRegisteredDevice(db,1,'industrial',{custom_fields:{custom_power:'35.5'}},1);insertRegisteredDevice(db,1,'industrial',{},1);}),{status:400});assert.equal(Number(db.prepare('SELECT COUNT(*) n FROM devices').get()!.n),before);
 const id=atomic(db,()=>insertRegisteredDevice(db,1,'industrial',{custom_fields:{custom_power:'35.5'}},1));const saved=db.prepare('SELECT * FROM devices WHERE id=?').get(id)!;assert.equal(saved.brand,null);assert.deepEqual(customDeviceSpecs(saved.specs),[{label:'توان',value:'35.5'}]);
 const next=readDeviceCatalog(db);next.types.find(t=>t.id==='industrial')!.active=false;saveDeviceCatalog(db,owner,next);assert.throws(()=>atomic(db,()=>insertRegisteredDevice(db,1,'industrial',{custom_fields:{custom_power:'99'}},1)),{status:400});assert.equal(db.prepare('SELECT specs FROM devices WHERE id=?').get(id)!.specs,saved.specs);
});
