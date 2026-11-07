import {before,after,describe,it} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {NextRequest} from "next/server";

const directory=fs.mkdtempSync(path.join(os.tmpdir(),"repaid-branch-chat-"));
process.env.REPAID_DATA_DIR=directory;
process.env.REPAID_DEMO_MODE="0";
let db: ReturnType<typeof import("../src/lib/db/schema").getDb>;
const ids:Record<string,number>={};
const tokens:Record<string,string>={};
function request(actor:string,url:string,body?:unknown,branch="all",method=body===undefined?"GET":"POST") {
  return new NextRequest(`http://app.test${url}`,{method,headers:{cookie:`repaid_session=${tokens[actor]}; repaid_branch=${branch}`,origin:"http://app.test","content-type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
async function session(actor:string) {
  const {getSessionByToken}=await import("../src/lib/auth");
  return getSessionByToken(tokens[actor])!;
}
before(async()=>{
  const {getDb}=await import("../src/lib/db/schema");
  const {createSession}=await import("../src/lib/auth");
  db=getDb();
  db.exec("INSERT INTO branches(id,name,code,is_active) VALUES(1,'BRANCH-ONE','ONE',1),(2,'BRANCH-TWO','TWO',1),(3,'INACTIVE','OFF',0)");
  for(const [name,role,branch] of [["owner","owner",1],["admin","admin",null],["manager1","manager",1],["manager2","manager",2],["staff1","reception",1],["staff2","reception",2],["tech1","technician",1],["inventory1","inventory",1],["unassigned","reception",null],["inactiveBranch","reception",3]] as const){
    ids[name]=Number(db.prepare("INSERT INTO users(name,email,password_hash,role,branch_id) VALUES(?,?,'invalid',?,?)").run(name,`${name}@test.local`,role,branch).lastInsertRowid);
    tokens[name]=createSession(ids[name]);
  }
  for(const branch of [1,2]){
    ids[`customer${branch}`]=Number(db.prepare("INSERT INTO customers(first_name,last_name,mobile,branch_id) VALUES(?,?,?,?)").run(`CUSTOMER-${branch}`,"SENTINEL",`0912000000${branch}`,branch).lastInsertRowid);
    ids[`device${branch}`]=Number(db.prepare("INSERT INTO devices(customer_id,type,brand,model,serial) VALUES(?,'mobile','BRAND',?,?)").run(ids[`customer${branch}`],`DEVICE-${branch}`,`SERIAL-${branch}`).lastInsertRowid);
    ids[`complaint${branch}`]=Number(db.prepare("INSERT INTO complaints(customer_id,description) VALUES(?,?)").run(ids[`customer${branch}`],`COMPLAINT-${branch}`).lastInsertRowid);
    ids[`warranty${branch}`]=Number(db.prepare("INSERT INTO warranties(customer_id,end_date) VALUES(?,'2099-01-01')").run(ids[`customer${branch}`]).lastInsertRowid);
    ids[`appointment${branch}`]=Number(db.prepare("INSERT INTO appointments(customer_id,branch_id,preferred_at) VALUES(?,?,'2026-11-01')").run(ids[`customer${branch}`],branch).lastInsertRowid);
    ids[`location${branch}`]=Number(db.prepare("INSERT INTO inventory_locations(name,branch_id) VALUES(?,?)").run(`LOCATION-${branch}`,branch).lastInsertRowid);
    db.prepare("INSERT INTO payments(customer_id,branch_id,amount,direction) VALUES(?,?,?,'in')").run(ids[`customer${branch}`],branch,100*branch);
  }
  ids.part=Number(db.prepare("INSERT INTO parts(name,sku,price) VALUES('PART','TONIGHT',100)").run().lastInsertRowid);
  for(const branch of [1,2])db.prepare("INSERT INTO inventory_stock(part_id,location_id,qty) VALUES(?,?,?)").run(ids.part,ids[`location${branch}`],branch===1?7:23);
});
after(()=>{db?.close();fs.rmSync(directory,{recursive:true,force:true});});

describe("two-branch business access using real API handlers and SQLite",()=>{
  it("ignores forged branch cookies for staff and branch managers; company administrators retain both branches",async()=>{
    const {activeBranch}=await import("../src/lib/branch");
    for(const actor of ["staff1","manager1"])for(const cookie of ["all","2","invalid"]){
      assert.deepEqual(activeBranch(await session(actor),cookie),{branchId:1,all:false,canSwitch:false});
    }
    for(const actor of ["owner","admin"]){
      assert.equal(activeBranch(await session(actor),"all").all,true);
      assert.equal(activeBranch(await session(actor),"2").branchId,2);
    }
    for(const actor of ["unassigned","inactiveBranch"]){
      assert.equal(activeBranch(await session(actor)).branchId,-1);
      const {GET}=await import("../src/app/api/customers/route");
      assert.equal((await GET(request(actor,"/api/customers"))).status,403);
    }
  });
  it("scopes customer lists, searches and duplicate-safe lookup before LIMIT",async()=>{
    const {GET}=await import("../src/app/api/customers/route");
    const {GET:lookup}=await import("../src/app/api/customers/lookup/route");
    for(const branch of [1,2]){
      for(const handler of [GET,lookup]){
        const response=await handler(request(`manager${branch}`,"/api/customers?q=CUSTOMER"));
        assert.equal(response.status,200);
        const {customers}=await response.json();
        assert.deepEqual(customers.map((r:{id:number})=>r.id),[ids[`customer${branch}`]]);
      }
    }
    assert.equal((await (await GET(request("owner","/api/customers"))).json()).customers.length,2);
    assert.deepEqual((await (await GET(request("owner","/api/customers",undefined,"2"))).json()).customers.map((r:{id:number})=>r.id),[ids.customer2]);
  });
  it("rejects foreign customer edits and forged business references without mutation",async()=>{
    const {POST}=await import("../src/app/api/customers/[id]/route");
    const before=db.prepare("SELECT * FROM customers WHERE id=?").get(ids.customer2);
    for(const action of ["blacklist","archive","update"]){
      const response=await POST(request("manager1",`/api/customers/${ids.customer2}`,{action,first_name:"TAMPER"}),{params:Promise.resolve({id:String(ids.customer2)})});
      assert.equal(response.status,404);
    }
    assert.deepEqual(db.prepare("SELECT * FROM customers WHERE id=?").get(ids.customer2),before);
    const {POST:device}=await import("../src/app/api/devices/route");
    assert.equal((await device(request("staff1","/api/devices",{customer_id:ids.customer2,type:"mobile"}))).status,404);
    const {POST:customer}=await import("../src/app/api/customers/route");
    assert.equal((await customer(request("staff1","/api/customers",{first_name:"TAMPER",branch_id:2}))).status,403);
  });
  it("persists a newly created customer in the actual employed branch",async()=>{
    const {POST}=await import("../src/app/api/customers/route");
    const response=await POST(request("staff2","/api/customers",{first_name:"NEW-OWN-BRANCH",mobile:"09129999999"}));
    assert.equal(response.status,200);
    const {id}=await response.json();
    assert.equal(db.prepare("SELECT branch_id FROM customers WHERE id=?").get(id)!.branch_id,2);
  });
  it("scopes devices, customer-specific device reads and serialized-number existence checks",async()=>{
    const {GET}=await import("../src/app/api/devices/route");
    const {GET:check}=await import("../src/app/api/devices/check/route");
    assert.deepEqual((await (await GET(request("staff1","/api/devices?q=DEVICE"))).json()).devices.map((r:{id:number})=>r.id),[ids.device1]);
    assert.equal((await GET(request("staff1",`/api/devices?customer_id=${ids.customer2}`))).status,404);
    assert.equal((await (await check(request("staff1","/api/devices/check?serial=SERIAL-2"))).json()).exists,false);
    assert.equal((await (await check(request("owner","/api/devices/check?serial=SERIAL-2"))).json()).exists,true);
  });
  it("preserves Persian legacy device creation while rejecting unsupported types",async()=>{
    const {POST}=await import("../src/app/api/devices/route");
    const response=await POST(request("staff1","/api/devices",{customer_id:ids.customer1,type:"موبایل",brand:"Legacy",model:"Compatible"}));
    assert.equal(response.status,200);
    const {id}=await response.json();
    const row=db.prepare("SELECT type,branch_id,customer_id FROM devices WHERE id=?").get(id)!;
    assert.deepEqual({...row},{type:"mobile",branch_id:1,customer_id:ids.customer1});
    assert.equal((await POST(request("staff1","/api/devices",{customer_id:ids.customer1,type:"unsupported"}))).status,400);
  });
  it("scopes complaints, appointments and customer-based warranties, including direct foreign mutations",async()=>{
    for(const [module,key,resource] of [["complaints","complaints","complaint"],["appointments","appointments","appointment"],["warranties","warranties","warranty"]] as const){
      const {GET}=await import(`../src/app/api/${module}/route`);
      const response=await GET(request("manager1",`/api/${module}`));
      assert.equal(response.status,200);
      assert.deepEqual((await response.json())[key].map((r:{id:number})=>r.id),[ids[`${resource}1`]]);
    }
    const {PATCH}=await import("../src/app/api/complaints/[id]/route");
    assert.equal((await PATCH(request("manager1",`/api/complaints/${ids.complaint2}`,{status:"closed"},"all","PATCH"),{params:Promise.resolve({id:String(ids.complaint2)})})).status,404);
    assert.equal(db.prepare("SELECT status FROM complaints WHERE id=?").get(ids.complaint2)!.status,"open");
  });
  it("limits employee and branch directories while protecting permission and daily-report details",async()=>{
    const {GET:users}=await import("../src/app/api/users/route");
    const {GET:branches}=await import("../src/app/api/branches/route");
    assert.ok((await (await users(request("manager1","/api/users"))).json()).users.every((u:{branch_id:number})=>u.branch_id===1));
    assert.deepEqual((await (await branches(request("manager1","/api/branches"))).json()).branches.map((b:{id:number})=>b.id),[1]);
    assert.equal((await (await branches(request("owner","/api/branches"))).json()).branches.length,3);
    const {GET:permissions}=await import("../src/app/api/team/permissions/route");
    assert.equal((await permissions(request("manager1",`/api/team/permissions?user_id=${ids.staff2}`))).status,404);
    const {GET:daily}=await import("../src/app/api/daily-reports/route");
    assert.equal((await daily(request("manager1",`/api/daily-reports?user_id=${ids.staff2}&from=2026-10-01&to=2026-10-31`))).status,404);
  });
  it("returns exact local stock in search, price and Excel export, with consolidated management totals",async()=>{
    const {GET:search}=await import("../src/app/api/parts/search/route");
    const {GET:price}=await import("../src/app/api/parts/price/route");
    const {GET:excel}=await import("../src/app/api/inventory/excel/route");
    const XLSX=await import("xlsx");
    for(const [actor,expected] of [["manager1",7],["manager2",23],["owner",30]] as const){
      assert.equal((await (await search(request(actor,"/api/parts/search?q=PART"))).json()).parts[0].stock,expected);
      assert.equal((await (await price(request(actor,`/api/parts/price?id=${ids.part}`))).json()).stock,expected);
      const response=await excel(request(actor,"/api/inventory/excel"));
      assert.equal(response.status,200);
      const wb=XLSX.read(Buffer.from(await response.arrayBuffer()),{type:"buffer"});
      const rows=XLSX.utils.sheet_to_json<Record<string,unknown>>(wb.Sheets[wb.SheetNames[0]]);
      assert.equal(rows[0]["موجودی"],expected);
    }
  });
  it("reconciles branch operational report totals with independent expected persisted sources",async()=>{
    const {panelReport}=await import("../src/lib/panel-report");
    const {activeBranch}=await import("../src/lib/branch");
    const a=panelReport(db,activeBranch(await session("manager1")),30);
    const b=panelReport(db,activeBranch(await session("manager2")),30);
    const all=panelReport(db,activeBranch(await session("owner")),"30'); DROP TABLE users;--");
    assert.equal(a.revenue,100);assert.equal(b.revenue,200);assert.equal(all.revenue,300);
    assert.equal(a.newCustomers,1);assert.equal(b.newCustomers,2);assert.equal(all.newCustomers,3);
    assert.equal(all.days,30);
  });
});

describe("legacy compatibility and less visible branch paths",()=>{
  it("scopes global search and rejects both old and new financial customer merge paths",async()=>{
    const {GET}=await import("../src/app/api/search/route");
    const data=await (await GET(request("staff1","/api/search?q=CUSTOMER"))).json();
    assert.ok(data.customers.every((r:{title:string})=>!r.title.includes("CUSTOMER-2")));
    const {POST}=await import("../src/app/api/customers/merge/route");
    const evidence=db.prepare("SELECT * FROM payments ORDER BY id").all();
    assert.equal((await POST(request("staff1","/api/customers/merge",{master_id:ids.customer1,duplicate_id:ids.customer2}))).status,404);
    const fresh=Number(db.prepare("INSERT INTO customers(first_name,branch_id) VALUES('EMPTY-DESTINATION',1)").run().lastInsertRowid);
    assert.equal((await POST(request("owner","/api/customers/merge",{master_id:fresh,duplicate_id:ids.customer1}))).status,409);
    assert.deepEqual(db.prepare("SELECT * FROM payments ORDER BY id").all(),evidence);
    assert.equal(db.prepare("SELECT is_archived FROM customers WHERE id=?").get(ids.customer1)!.is_archived,0);
  });
  it("protects report-builder sources, saved report ownership and branch-qualified output",async()=>{
    const api=await import("../src/app/api/report-builder/route");
    for(const branch of [1,2]){
      const response=await api.POST(request(`manager${branch}`,"/api/report-builder",{source:"payments"}));
      assert.equal(response.status,200);
      const data=await response.json();assert.equal(data.rows.length,1);assert.equal(data.rows[0]["مبلغ"],100*branch);
    }
    assert.equal((await api.POST(request("inventory1","/api/report-builder",{source:"payments"}))).status,403);
    const offered=(await (await api.GET(request("inventory1","/api/report-builder"))).json()).sources;
    assert.deepEqual(offered.map((s:{key:string})=>s.key),["parts"]);
    for(const source of ["repairs","invoices","sales","payments","parts","customers"]){
      assert.equal((await api.POST(request("owner","/api/report-builder",{source}))).status,200,source);
    }
    const saved=await api.PUT(request("manager1","/api/report-builder",{name:"PRIVATE-BRANCH-ONE",source:"customers"},"all","PUT"));
    assert.equal(saved.status,200);const {id}=await saved.json();
    assert.equal(db.prepare("SELECT branch_id FROM saved_reports WHERE id=?").get(id)!.branch_id,1);
    assert.equal((await (await api.GET(request("manager2","/api/report-builder"))).json()).saved.length,0);
    assert.equal((await api.DELETE(request("manager2",`/api/report-builder?id=${id}`,undefined,"all","DELETE"))).status,404);
    assert.ok(db.prepare("SELECT id FROM saved_reports WHERE id=?").get(id));
  });
  it("rejects corrupt signature evidence instead of silently saving a report without it",async()=>{
    const api=await import('../src/app/api/daily-reports/route');
    const date='2026-01-17',body={report_date:date,status:'draft',summary:'Signature integrity acceptance',mood:3};
    const invalid=await api.POST(request('manager1','/api/daily-reports',{...body,signature_data:'data:image/png;base64,AAAA'}));
    assert.equal(invalid.status,400);assert.equal(db.prepare('SELECT id FROM daily_reports WHERE user_id=? AND report_date=?').get(ids.manager1,date),undefined);
    const image=await (await import('qrcode')).default.toDataURL('Real PNG acceptance');
    assert.equal((await api.POST(request('manager1','/api/daily-reports',{...body,signature_data:image}))).status,200);
    const stored=db.prepare('SELECT * FROM daily_reports WHERE user_id=? AND report_date=?').get(ids.manager1,date)!;assert.equal(stored.signature_data,image);
    assert.equal((await api.POST(request('manager1','/api/daily-reports',{...body,revision:stored.revision,status:'submitted',resign:true,correction_reason:'Correcting this report with retained evidence',summary:'Must not replace evidence',signature_data:'data:image/png;base64,AAAA'}))).status,400);
    assert.deepEqual(db.prepare('SELECT * FROM daily_reports WHERE id=?').get(stored.id),stored);
    const legacy='data:image/png;base64,LEGACY';
    db.prepare('UPDATE daily_reports SET signature_data=? WHERE id=?').run(legacy,stored.id);
    assert.equal((await api.POST(request('manager1','/api/daily-reports',{...body,revision:stored.revision,summary:'Text-only legacy report update',signature_data:legacy}))).status,409);
    const fresh=await (await import('qrcode')).default.toDataURL('Fresh author correction');
    assert.equal((await api.POST(request('manager1','/api/daily-reports',{...body,revision:stored.revision,status:'submitted',resign:true,correction_reason:'Correcting the legacy report with new evidence',summary:'New author-signed correction',signature_data:fresh}))).status,200);
    const preserved=db.prepare('SELECT * FROM daily_reports WHERE id=?').get(stored.id)!;
    assert.equal(preserved.signature_data,fresh);assert.equal(preserved.summary,'New author-signed correction');
    const archived=db.prepare('SELECT snapshot_json FROM daily_report_versions WHERE report_id=? AND revision=?').get(stored.id,stored.revision)!;
    // The archive retains the original version already saved by the API.
    assert.equal(JSON.parse(String(archived.snapshot_json)).signature_data,image);
    assert.equal((await api.POST(request('manager1','/api/daily-reports',{...body,revision:preserved.revision,status:'submitted',resign:true,correction_reason:'Another attempted correction',signature_data:legacy+'CHANGED'}))).status,400);
    assert.deepEqual(db.prepare('SELECT * FROM daily_reports WHERE id=?').get(stored.id),preserved);
  });
  it("freezes report ownership at creation and preserves a transferred employee's previous report without exposing it",async()=>{
    const api=await import("../src/app/api/daily-reports/route");
    const report={report_date:"2026-10-28",status:"submitted",summary:"فعالیت داخلی مربوط به شعبهٔ نخست",mood:3};
    const posted=await api.POST(request("staff1","/api/daily-reports",report));assert.equal(posted.status,200);
    const original=db.prepare("SELECT * FROM daily_reports WHERE user_id=? AND report_date=?").get(ids.staff1,report.report_date)!;
    assert.equal(original.branch_id,1);
    db.prepare("UPDATE users SET branch_id=2 WHERE id=?").run(ids.staff1);
    try{
      const own=await api.GET(request("staff1","/api/daily-reports?activity=2026-10-28"));assert.equal(own.status,200);assert.equal((await own.json()).report,null);
      assert.equal((await api.POST(request("staff1","/api/daily-reports",{...report,summary:"BLOCKED-TRANSFERRED-REPORT"}))).status,409);
      const management=await api.GET(request("owner",`/api/daily-reports?user_id=${ids.staff1}&activity=2026-10-28`));
      assert.equal(management.status,200);assert.equal((await management.json()).report.id,original.id);
      assert.deepEqual(db.prepare("SELECT * FROM daily_reports WHERE id=?").get(original.id),original);
    }finally{db.prepare("UPDATE users SET branch_id=1 WHERE id=?").run(ids.staff1);}
  });
  it("protects device maintenance and stamped blacklist records through direct API calls",async()=>{
    const reminders=await import("../src/app/api/devices/service-reminders/route");
    assert.equal((await reminders.POST(request("tech1","/api/devices/service-reminders",{device_id:ids.device1,next_service_date:"2026-11-01"}))).status,403);
    assert.equal((await reminders.POST(request("staff1","/api/devices/service-reminders",{device_id:ids.device2,next_service_date:"2026-11-01"}))).status,404);
    const {POST}=await import("../src/app/api/devices/check/route");
    assert.equal((await POST(request("staff1","/api/devices/check",{device_id:ids.device1,reason:"PRIVATE-ONE"}))).status,200);
    const row=db.prepare("SELECT * FROM device_blacklist WHERE device_id=?").get(ids.device1)!;assert.equal(row.branch_id,1);
    const api=await import("../src/app/api/devices/blacklist/route");
    assert.equal((await (await api.GET(request("staff2","/api/devices/blacklist"))).json()).entries.length,0);
    assert.equal((await api.DELETE(request("staff2",`/api/devices/blacklist?id=${row.id}`,undefined,"all","DELETE"))).status,404);
  });
  it("scopes supplier lists/exports and converts only one branch atomically, preserving the other branch",async()=>{
    const supplier=Number(db.prepare("INSERT INTO suppliers(name) VALUES('SHARED SUPPLIER')").run().lastInsertRowid);
    const item1=Number(db.prepare("INSERT INTO supplier_purchase_items(supplier_id,name,qty,est_cost,branch_id) VALUES(?,'PRIVATE-ONE',1,100,1)").run(supplier).lastInsertRowid);
    const item2=Number(db.prepare("INSERT INTO supplier_purchase_items(supplier_id,name,qty,est_cost,branch_id) VALUES(?,'PRIVATE-TWO',2,200,2)").run(supplier).lastInsertRowid);
    const api=await import("../src/app/api/suppliers/[id]/purchase-list/route");
    const params={params:Promise.resolve({id:String(supplier)})};
    const one=await api.GET(request("manager1",`/api/suppliers/${supplier}/purchase-list`),params);
    assert.equal(one.status,200);assert.deepEqual((await one.json()).items.map((r:{id:number})=>r.id),[item1]);
    const {POST:convert}=await import("../src/app/api/suppliers/[id]/purchase-list/convert/route");
    const conversionRequest=(key='branch-conversion-once')=>{const req=request('manager1',`/api/suppliers/${supplier}/purchase-list/convert`,{});req.headers.set('Idempotency-Key',key);return req;};
    assert.equal((await convert(request('manager1',`/api/suppliers/${supplier}/purchase-list/convert`,{}),params)).status,400);
    db.exec("CREATE TRIGGER tonight_po_audit_failure BEFORE INSERT ON audit_logs WHEN NEW.entity='purchase_order' BEGIN SELECT RAISE(ABORT,'injected audit failure'); END");
    try{assert.equal((await convert(conversionRequest(),params)).status,500);}finally{db.exec("DROP TRIGGER tonight_po_audit_failure");}
    assert.equal(db.prepare("SELECT COUNT(*) n FROM purchase_orders WHERE supplier_id=?").get(supplier)!.n,0);
    assert.equal(db.prepare("SELECT po_id FROM supplier_purchase_items WHERE id=?").get(item1)!.po_id,null);
    const converted=await convert(conversionRequest(),params);assert.equal(converted.status,200);
    const {id}=await converted.json();assert.equal(db.prepare("SELECT branch_id FROM purchase_orders WHERE id=?").get(id)!.branch_id,1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM purchase_order_items WHERE po_id=?").get(id)!.n,1);
    assert.equal(db.prepare("SELECT po_id FROM supplier_purchase_items WHERE id=?").get(item2)!.po_id,null);
    const replay=await convert(conversionRequest(),params);assert.equal(replay.status,200);assert.equal((await replay.json()).id,id);
    assert.equal((await convert(conversionRequest('branch-conversion-again'),params)).status,409);
  });
  it("denies old-message attachments, current-branch transfers and writes using stale membership objects",async()=>{
    const chat=await import("../src/lib/chat");
    const manager=await session("manager1"),staff=await session("staff1");
    const group=chat.createGroupConversation(db,manager,{type:"group",title:"ATTACHMENTS",memberIds:[ids.tech1]});
    const membership=chat.requireConversation(db,group,ids.manager1);
    const attachment=Number(db.prepare("INSERT INTO chat_attachments(uploaded_by,filename,mime,size,data) VALUES(?,'private.txt','text/plain',6,?)").run(ids.manager1,Buffer.from("SECRET")).lastInsertRowid);
    const sent=chat.postMessage(db,manager,membership.conv,membership.member,{body:"SECRET FILE",attachment_ids:[attachment]}).message;
    chat.addMember(db,manager,group,ids.staff1);
    const {GET}=await import("../src/app/api/chat/attachments/[id]/route");
    assert.equal((await GET(request("staff1",`/api/chat/attachments/${attachment}`),{params:Promise.resolve({id:String(attachment)})})).status,404);
    assert.throws(()=>chat.requireVisibleChatMessage(db,ids.staff1,sent.id),{status:404});
    const stale=chat.requireConversation(db,group,ids.staff1);
    db.prepare("UPDATE users SET branch_id=2 WHERE id=?").run(ids.staff1);
    try{assert.throws(()=>chat.postMessage(db,staff,stale.conv,stale.member,{body:"STALE-BRANCH-WRITE"}),{status:404});}finally{db.prepare("UPDATE users SET branch_id=1 WHERE id=?").run(ids.staff1);}
    assert.equal(db.prepare("SELECT COUNT(*) n FROM chat_messages WHERE body='STALE-BRANCH-WRITE'").get()!.n,0);
  });
});

describe("internal-only organizational chat and employment changes",()=>{
  it("supports staff DMs and company management contact, blocks foreign-branch users and include-ID leaks",async()=>{
    const chat=await import("../src/lib/chat");
    const one=await session("staff1");
    ids.dm=chat.ensureDirectConversation(db,one,ids.manager1);
    assert.equal(chat.ensureDirectConversation(db,one,ids.manager1),ids.dm);
    assert.throws(()=>chat.ensureDirectConversation(db,one,ids.staff2),{status:403});
    const management=chat.ensureDirectConversation(db,await session("staff2"),ids.owner);
    assert.equal(chat.requireConversation(db,management,ids.staff2).conv.branch_id,2);
    const {GET}=await import("../src/app/api/chat/users/route");
    const users=(await (await GET(request("staff1",`/api/chat/users?include=${ids.staff2}`))).json()).users;
    assert.ok(!users.some((u:{id:number})=>u.id===ids.staff2));
    assert.ok(users.some((u:{id:number})=>u.id===ids.owner));
  });
  it("rejects new customer/document chats and hides preserved legacy linked threads everywhere",async()=>{
    const chat=await import("../src/lib/chat");
    const actor=await session("staff1");
    for(const entity of ["customer","repair","invoice"]) assert.throws(()=>chat.ensureEntityConversation(db,actor,entity,ids.customer1),{status:410});
    const {POST}=await import("../src/app/api/chat/conversations/route");
    assert.equal((await POST(request("staff1","/api/chat/conversations",{type:"direct",user_id:ids.owner,scope:"customer"}))).status,410);
    ids.legacy=Number(db.prepare("INSERT INTO chat_conversations(type,title,entity_type,entity_id,branch_id,created_by) VALUES('group','LEGACY-PRIVATE','customer',?,1,?)").run(ids.customer1,ids.owner).lastInsertRowid);
    db.prepare("INSERT INTO chat_members(conversation_id,user_id,role) VALUES(?,?,'member')").run(ids.legacy,ids.staff1);
    db.prepare("INSERT INTO chat_messages(conversation_id,sender_id,body,search_text) VALUES(?,?,'SECRET LEGACY','secret legacy')").run(ids.legacy,ids.owner);
    chat.pushEvent(db,ids.legacy,"message",{body:"SECRET LEGACY"},ids.owner);
    assert.throws(()=>chat.requireConversation(db,ids.legacy,ids.staff1),{status:404});
    assert.ok(!chat.listConversations(db,actor,{filter:"all",q:"",withPresence:false}).some(c=>c.id===ids.legacy));
    assert.ok(!chat.chatSummary(db,ids.staff1).conversations.some(c=>c.id===ids.legacy));
    assert.equal(chat.searchChat(db,actor,{q:"secret"}).results.length,0);
    assert.ok(!chat.fetchEvents(db,actor,0,null).events.some(e=>e.conversation_id===ids.legacy));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM chat_messages WHERE conversation_id=?").get(ids.legacy)!.n,1);
  });
  it("rejects customer portal messages without creating messages or notifications, even for authenticated staff",async()=>{
    const {POST}=await import("../src/app/api/track/message/route");
    const before=db.prepare("SELECT COUNT(*) n FROM messages").get()!.n;
    assert.equal((await POST(request("owner","/api/track/message",{token:"legacy-token",body:"BLOCKED"}))).status,410);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM messages").get()!.n,before);
  });
  it("rolls an internal group and its members back after an injected database failure",async()=>{
    const chat=await import("../src/lib/chat");
    const before=db.prepare("SELECT COUNT(*) n FROM chat_conversations").get()!.n;
    db.exec(`CREATE TRIGGER tonight_fail_group BEFORE INSERT ON chat_members WHEN NEW.user_id=${ids.tech1} BEGIN SELECT RAISE(ABORT,'injected group failure'); END`);
    try{assert.throws(()=>chat.createGroupConversation(db,awaitedManager(),{type:"group",title:"ROLLBACK",memberIds:[ids.tech1]}),/injected group failure/);}finally{db.exec("DROP TRIGGER tonight_fail_group");}
    assert.equal(db.prepare("SELECT COUNT(*) n FROM chat_conversations").get()!.n,before);
    function awaitedManager(){return {user:{id:ids.manager1,name:"manager1",role:"manager",branch_id:1,email:"manager1@test.local",avatar_color:"#000000"}};}
  });
  it("revokes old branch conversations, messages, search, summaries and events immediately after staff transfer",async()=>{
    const chat=await import("../src/lib/chat");
    ids.branchGroup=chat.createGroupConversation(db,await session("manager1"),{type:"group",title:"BRANCH-ONE-GROUP",memberIds:[ids.staff1]});
    const member=chat.requireConversation(db,ids.branchGroup,ids.manager1);
    chat.postMessage(db,await session("manager1"),member.conv,member.member,{body:"secret old branch",client_key:"old-branch"});
    db.prepare("INSERT INTO notifications(user_id,title,body) VALUES(?,'OLD-BRANCH','secret')").run(ids.staff1);
    assert.equal(db.prepare("SELECT branch_id FROM notifications WHERE user_id=?").get(ids.staff1)!.branch_id,1);
    db.prepare("UPDATE users SET branch_id=2 WHERE id=?").run(ids.staff1);
    const moved=await session("staff1");assert.equal(moved.user.branch_id,2);
    chat.postMessage(db,await session("manager1"),member.conv,member.member,{body:"SECRET AFTER TRANSFER",mentions:[ids.staff1]});
    assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND body LIKE '%SECRET AFTER TRANSFER%'").get(ids.staff1)!.n,0);
    assert.ok(!chat.getMemberList(db,ids.branchGroup,false).some(m=>m.user_id===ids.staff1));
    for(const id of [ids.dm,ids.branchGroup]){
      assert.throws(()=>chat.requireConversation(db,id,ids.staff1),{status:404});
      assert.throws(()=>chat.fetchMessages(db,moved,id,{}),{status:404});
      assert.throws(()=>chat.fetchEvents(db,moved,0,id),{status:404});
    }
    assert.throws(()=>chat.ensureDirectConversation(db,moved,ids.manager1),{status:403});
    assert.ok(!chat.listConversations(db,moved,{filter:"all",q:"",withPresence:false}).some(c=>c.id===ids.branchGroup));
    assert.equal(chat.searchChat(db,moved,{q:"secret"}).results.length,0);
    assert.equal(chat.chatSummary(db,ids.staff1).unread_total,0);
    const {GET}=await import("../src/app/api/notifications/route");
    assert.equal((await (await GET(request("staff1","/api/notifications"))).json()).notifications.length,0);
    db.prepare("UPDATE users SET branch_id=1 WHERE id=?").run(ids.staff1);
  });
  it("allows explicit internal company-wide groups while keeping branch business records inaccessible",async()=>{
    const chat=await import("../src/lib/chat");
    const id=chat.createGroupConversation(db,await session("owner"),{type:"group",title:"INTERNAL COMPANY",memberIds:[ids.staff1,ids.staff2]});
    assert.equal(chat.requireConversation(db,id,ids.staff1).conv.branch_id,null);
    assert.equal(chat.requireConversation(db,id,ids.staff2).conv.branch_id,null);
    const {GET}=await import("../src/app/api/customers/route");
    assert.ok((await (await GET(request("staff1","/api/customers"))).json()).customers.every((c:{branch_id:number})=>c.branch_id===1));
  });
});

describe("populated legacy identities and request-time employment safety",()=>{
  it("derives read access from actual local documents without assigning or rewriting a legacy shared customer",async()=>{
    const customer=Number(db.prepare("INSERT INTO customers(first_name,last_name) VALUES('LEGACY-SHARED','SOURCE-EVIDENCE')").run().lastInsertRowid);
    const status=Number(db.prepare("INSERT INTO repair_statuses(name,category) VALUES('LEGACY-SCOPE','open')").run().lastInsertRowid);
    const devices:Record<number,number>={};
    for(const branch of [1,2]){
      devices[branch]=Number(db.prepare("INSERT INTO devices(customer_id,type,model) VALUES(?,'mobile',?)").run(customer,`LEGACY-DEVICE-${branch}`).lastInsertRowid);
      db.prepare("INSERT INTO repair_tickets(number,branch_id,customer_id,device_id,status_id) VALUES(?,?,?,?,?)").run(`LEGACY-SCOPE-${branch}`,branch,customer,devices[branch],status);
    }
    assert.deepEqual(db.prepare("SELECT branch_id FROM customer_branch_access WHERE customer_id=? ORDER BY branch_id").all(customer).map(r=>r.branch_id),[1,2]);
    const customers=await import("../src/app/api/customers/route");
    const deviceApi=await import("../src/app/api/devices/route");
    for(const branch of [1,2]){
      const visible=await customers.GET(request(`staff${branch}`,"/api/customers?q=LEGACY-SHARED"));assert.equal(visible.status,200);
      assert.deepEqual((await visible.json()).customers.map((c:{id:number})=>c.id),[customer]);
      const ownDevices=await deviceApi.GET(request(`staff${branch}`,`/api/devices?customer_id=${customer}`));assert.equal(ownDevices.status,200);
      assert.deepEqual((await ownDevices.json()).devices.map((d:{id:number})=>d.id),[devices[branch]]);
    }
    const {POST}=await import("../src/app/api/customers/[id]/route");
    assert.equal((await POST(request("staff1",`/api/customers/${customer}`,{action:"update",notes:"BLOCKED-OTHER-BRANCH"}),{params:Promise.resolve({id:String(customer)})})).status,403);
    const row=db.prepare("SELECT branch_id,notes FROM customers WHERE id=?").get(customer)!;
    assert.equal(row.branch_id,null);assert.equal(row.notes,null);
    for(const id of Object.values(devices))assert.equal(db.prepare("SELECT branch_id FROM devices WHERE id=?").get(id)!.branch_id,null);
  });
  it("revalidates employment and explicitly granted permissions after an asynchronous request body",async()=>{
    const {requireSession,requirePerm,readJson}=await import("../src/lib/api");
    const req=request("staff1","/api/customers",{first_name:"NO-STALE-WRITE"});
    const initial=requireSession(req);requirePerm(initial,"customers.create");
    db.prepare("UPDATE users SET branch_id=2 WHERE id=?").run(ids.staff1);
    try{await assert.rejects(()=>readJson(req),{status:409});}finally{db.prepare("UPDATE users SET branch_id=1 WHERE id=?").run(ids.staff1);}
    const revoked=request("staff1","/api/customers",{first_name:"NO-REVOKED-WRITE"});
    requirePerm(requireSession(revoked),"customers.create");
    db.prepare("INSERT INTO user_permissions(user_id,perm,effect) VALUES(?,'customers.create','deny')").run(ids.staff1);
    try{await assert.rejects(()=>readJson(revoked),{status:403});}finally{db.prepare("DELETE FROM user_permissions WHERE user_id=? AND perm='customers.create'").run(ids.staff1);}
    assert.equal(db.prepare("SELECT COUNT(*) n FROM customers WHERE first_name LIKE 'NO-%-WRITE'").get()!.n,0);
  });
});

describe("company chat controls and concurrent creation",()=>{
  it("keeps company-wide moderation under company control or an explicit group promotion",async()=>{
    const chat=await import("../src/lib/chat");
    const owner=await session("owner"),manager=await session("manager1");
    const group=chat.createGroupConversation(db,owner,{type:"group",title:"COMPANY-CONTROLS",memberIds:[ids.manager1,ids.staff2]});
    const access=chat.requireConversation(db,group,ids.manager1);
    assert.equal(chat.canManageConversation(manager,access.member,access.conv),false);
    assert.throws(()=>chat.updateConversation(db,manager,group,{title:"UNAUTHORIZED"}),{status:403});
    chat.updateConversation(db,owner,group,{title:"COMPANY-APPROVED"});
    chat.setMemberRole(db,owner,group,ids.manager1,"admin");
    chat.updateConversation(db,manager,group,{description:"Explicit group approval"});
    assert.equal(db.prepare("SELECT title,description FROM chat_conversations WHERE id=?").get(group)!.title,"COMPANY-APPROVED");
    assert.equal(db.prepare("SELECT branch_id FROM audit_logs WHERE entity='chat_conversation' AND entity_id=? AND action='create'").get(group)!.branch_id,null);
  });
  it("rejects another sender's client key instead of falsely acknowledging or misattributing their message",async()=>{
    const chat=await import("../src/lib/chat");
    const manager=await session("manager1"),staff=await session("staff1");
    const group=chat.createGroupConversation(db,manager,{type:"group",title:"MESSAGE-IDENTITY",memberIds:[ids.staff1]});
    const a=chat.requireConversation(db,group,ids.manager1),b=chat.requireConversation(db,group,ids.staff1);
    chat.postMessage(db,manager,a.conv,a.member,{body:"ORIGINAL-AUTHOR",client_key:"SENDER-BOUND-KEY"});
    assert.throws(()=>chat.postMessage(db,staff,b.conv,b.member,{body:"WRONG-AUTHOR",client_key:"SENDER-BOUND-KEY"}),{status:409});
    assert.equal(db.prepare("SELECT COUNT(*) n FROM chat_messages WHERE conversation_id=? AND kind='text'").get(group)!.n,1);
  });
  it("creates a direct conversation only once across two independent SQLite writer processes",async()=>{
    const {spawn}=await import("node:child_process");
    const peers=["concurrent-a","concurrent-b"].map(name=>Number(db.prepare("INSERT INTO users(name,email,password_hash,role,branch_id) VALUES(?,?,'invalid','reception',1)").run(name,`${name}@test.local`).lastInsertRowid));
    const code=`const{getDb}=require('./src/lib/db/schema.ts');const{ensureDirectConversation}=require('./src/lib/chat.ts');const db=getDb();const actor={user:db.prepare('SELECT * FROM users WHERE id=?').get(${peers[0]})};try{console.log(ensureDirectConversation(db,actor,${peers[1]}));}finally{db.close();}`;
    const worker=()=>new Promise<number>((resolve,reject)=>{
      const child=spawn(process.execPath,["--import","tsx","--eval",code],{cwd:process.cwd(),env:{...process.env,REPAID_DATA_DIR:directory},windowsHide:true});
      let output="",error="";child.stdout.on("data",chunk=>output+=chunk);child.stderr.on("data",chunk=>error+=chunk);child.on("error",reject);child.on("close",exit=>exit===0?resolve(Number(output.trim())):reject(new Error(error)));
    });
    const [first,second]=await Promise.all([worker(),worker()]);assert.equal(first,second);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM chat_members WHERE conversation_id=?").get(first)!.n,2);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM chat_events WHERE conversation_id=? AND type='conversation_created'").get(first)!.n,1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity='chat_conversation' AND entity_id=? AND action='create'").get(first)!.n,1);
  });
  it("starts a new branch-owned management DM after transfer and leaves the old context read-only",async()=>{
    const chat=await import("../src/lib/chat");
    const owner=await session("owner");
    const before=chat.ensureDirectConversation(db,await session("staff1"),ids.owner);
    assert.equal(chat.requireConversation(db,before,ids.staff1).conv.branch_id,1);
    db.prepare("UPDATE users SET branch_id=2 WHERE id=?").run(ids.staff1);
    try{
      const historical=chat.requireConversation(db,before,ids.owner);
      assert.equal(chat.canPostIn(historical.conv,historical.member,owner,db),false);
      assert.throws(()=>chat.postMessage(db,owner,historical.conv,historical.member,{body:"UNREACHABLE OLD CONTEXT"}),{status:403});
      const after=chat.ensureDirectConversation(db,await session("staff1"),ids.owner);
      assert.notEqual(before,after);
      assert.equal(chat.ensureDirectConversation(db,owner,ids.staff1),after);
      const active=chat.requireConversation(db,after,ids.staff1);
      assert.equal(active.conv.branch_id,2);
      assert.throws(()=>chat.requireConversation(db,before,ids.staff1),{status:404});
      const sent=chat.postMessage(db,await session("staff1"),active.conv,active.member,{body:"NEW EMPLOYMENT CONTEXT"}).message;
      assert.equal(db.prepare("SELECT conversation_id FROM chat_messages WHERE id=?").get(sent.id)!.conversation_id,after);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM chat_messages WHERE body='UNREACHABLE OLD CONTEXT'").get()!.n,0);
    }finally{db.prepare("UPDATE users SET branch_id=1 WHERE id=?").run(ids.staff1);}
  });
  it("does not notify a former branch technician about private repair activity",async()=>{
    const {notifyUser}=await import("../src/lib/repair");
    const status=db.prepare("SELECT id FROM repair_statuses ORDER BY id LIMIT 1").get()!.id;
    const ticket=Number(db.prepare("INSERT INTO repair_tickets(number,branch_id,customer_id,device_id,status_id) VALUES('NOTICE-SCOPE',1,?,?,?)").run(ids.customer1,ids.device1,status).lastInsertRowid);
    assert.equal(notifyUser(ids.staff2,"PRIVATE REPAIR","NO FOREIGN NOTICE",`/repairs/${ticket}`),false);
    assert.equal(notifyUser(ids.staff1,"PRIVATE REPAIR","LOCAL NOTICE",`/repairs/${ticket}`),true);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND body='NO FOREIGN NOTICE'").get(ids.staff2)!.n,0);
    assert.equal(db.prepare("SELECT branch_id FROM notifications WHERE user_id=? AND body='LOCAL NOTICE'").get(ids.staff1)!.branch_id,1);
  });
  it("keeps consolidated low-stock quantities out of branch employee notifications",async()=>{
    const {checkLowStock}=await import("../src/lib/inventory");
    db.prepare("UPDATE parts SET reorder_point=100 WHERE id=?").run(ids.part);
    checkLowStock(ids.part);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE title='موجودی کم' AND user_id=?").get(ids.inventory1)!.n,0);
    assert.equal(db.prepare("SELECT branch_id FROM notifications WHERE title='موجودی کم' AND user_id=?").get(ids.owner)!.branch_id,null);
  });
});
