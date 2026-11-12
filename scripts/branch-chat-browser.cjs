const {choose}=require('./browser-select.cjs');
/** Local acceptance only. Refuses original data and port 3000. Run with node --import tsx. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright-core');
const BASE=process.env.BRANCH_QA_BASE||'http://127.0.0.1:3002';
const manifest=JSON.parse(fs.readFileSync('.qa-work/fixture-20.json','utf8'));
const directory=path.resolve(manifest.directory),root=path.resolve('.qa-work/fixtures')+path.sep;
if(process.env.BRANCH_QA_MODE!=='1'||!directory.startsWith(root)||!/^http:\/\/127\.0\.0\.1:(?!3000\b)\d+$/.test(BASE))throw Error('Disposable local fixture and BRANCH_QA_MODE=1 required');
process.env.REPAID_DATA_DIR=directory;process.env.REPAID_DEMO_MODE='0';
const {getDb}=require('../src/lib/db/schema.ts');
const {canUser}=require('../src/lib/auth.ts');
const {pagePermission}=require('../src/lib/page-permissions.ts');
const db=getDb();
const password='fixture-password-2026',hash=crypto.scryptSync(password,'repaid-static-salt',32).toString('hex');
const actors={},sources={};
db.exec('BEGIN IMMEDIATE');
try{
  for(const branch of [1,2]){
    db.prepare('INSERT OR IGNORE INTO branches(id,name,code,is_active) VALUES(?,?,?,1)').run(branch,`شعبهٔ آزمون ${branch}`,`BRANCH-QA-${branch}`);
    for(const role of ['manager','reception','technician','inventory','accountant','sales']){
      const email=`tonight-${role}${branch}@test.local`,name=`کارمند آزمون ${role} ${branch}`;
      let row=db.prepare('SELECT * FROM users WHERE email=?').get(email);
      if(!row){const result=db.prepare('INSERT INTO users(name,email,password_hash,role,branch_id) VALUES(?,?,?,?,?)').run(name,email,hash,role,branch);row=db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid);}
      actors[`${role}${branch}`]={...row,password};
    }
    const marker=`TONIGHT-PRIVATE-BRANCH-${branch}`;
    let customer=db.prepare('SELECT id FROM customers WHERE first_name=?').get(marker)?.id;
    if(!customer)customer=Number(db.prepare("INSERT INTO customers(first_name,last_name,mobile,branch_id) VALUES(?,'PRIVATE',?,?)").run(marker,`0912888888${branch}`,branch).lastInsertRowid);
    let device=db.prepare('SELECT id FROM devices WHERE customer_id=?').get(customer)?.id;
    if(!device)device=Number(db.prepare("INSERT INTO devices(customer_id,type,brand,model,serial) VALUES(?,'mobile','TEST',?,?)").run(customer,marker,`${marker}-SERIAL`).lastInsertRowid);
    let ticket=db.prepare('SELECT id FROM repair_tickets WHERE number=?').get(`${marker}-REPAIR`)?.id;
    if(!ticket)ticket=Number(db.prepare("INSERT INTO repair_tickets(number,branch_id,customer_id,device_id,status_id,problem,technician_id) VALUES(?,?,?,?,(SELECT id FROM repair_statuses WHERE name='New'),?,?)").run(`${marker}-REPAIR`,branch,customer,device,marker,actors[`technician${branch}`].id).lastInsertRowid);
    let invoice=db.prepare('SELECT id FROM invoices WHERE number=?').get(`${marker}-INVOICE`)?.id;
    if(!invoice)invoice=Number(db.prepare("INSERT INTO invoices(number,customer_id,branch_id,date,status,total,paid) VALUES(?,?,?,date('now'),'issued',1000,0)").run(`${marker}-INVOICE`,customer,branch).lastInsertRowid);
    db.prepare("INSERT INTO complaints(customer_id,ticket_id,description) VALUES(?,?,?)").run(customer,ticket,marker);
    const supplier=db.prepare("SELECT id FROM suppliers ORDER BY id LIMIT 1").get()?.id??Number(db.prepare("INSERT INTO suppliers(name) VALUES('Company test supplier')").run().lastInsertRowid);
    let purchase=db.prepare('SELECT id FROM purchase_orders WHERE number=?').get(marker+'-PO')?.id;
    if(!purchase)purchase=Number(db.prepare("INSERT INTO purchase_orders(number,supplier_id,branch_id,status,total) VALUES(?,?,?,'draft',0)").run(marker+'-PO',supplier,branch).lastInsertRowid);
    if(!db.prepare('SELECT id FROM payments WHERE number=?').get(marker+'-RECEIPT'))db.prepare("INSERT INTO payments(number,customer_id,branch_id,amount,method,direction) VALUES(?,?,?,?,'cash','in')").run(marker+'-RECEIPT',customer,branch,branch*100);
    if(!db.prepare('SELECT id FROM expenses WHERE description=?').get(marker+'-EXPENSE'))db.prepare("INSERT INTO expenses(category,amount,date,branch_id,description) VALUES('TEST',?,date('now'),?,?)").run(branch*10,branch,marker+'-EXPENSE');
    db.prepare("INSERT INTO messages(customer_id,ticket_id,direction,channel,body,status) VALUES(?,?,'in','portal',?,'received')").run(customer,ticket,`HIDDEN-LEGACY-CUSTOMER-MESSAGE-${branch}`);
    sources[branch]={marker,customer,device,ticket,invoice,purchase};
  }
  actors.owner={...db.prepare("SELECT * FROM users WHERE email='owner@repaid.local'").get(),password:'demo1234'};
  db.exec('COMMIT');
}catch(error){db.exec('ROLLBACK');throw error;}

function chrome(){
  const cache=path.join(process.env.LOCALAPPDATA||'','ms-playwright');
  if(fs.existsSync(cache))for(const folder of fs.readdirSync(cache).filter(n=>n.startsWith('chromium-')).sort().reverse())for(const rel of ['chrome-win64/chrome.exe','chrome-win/chrome.exe']){const name=path.join(cache,folder,rel);if(fs.existsSync(name))return name;}
  for(const name of ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'])if(fs.existsSync(name))return name;
  throw Error('No local browser');
}
const results=[],errors=[],captures=[];
const out=path.resolve('.qa-work/tonight-browser');fs.mkdirSync(out,{recursive:true});
function check(name,condition,detail=''){results.push({name,ok:!!condition,detail:condition?'':String(detail)});if(!condition)console.log('FAIL '+name+' '+detail);}
const pages=['/','/appointments','/audit','/bank','/calendar','/chat','/checks','/communication','/complaints','/customers','/customers/new','/daily-report','/devices','/devices/new','/estimates','/expenses','/expenses/new','/finance','/finance/accounting','/installments','/inventory-tools','/invoices','/invoices/new','/labels','/outbox','/parts','/parts/new','/payments','/payments/new','/payroll','/pos','/purchase-orders','/purchase-orders/new','/repairs','/repairs/assignment','/repairs/board','/repairs/bulk','/repairs/new','/repairs/queue','/repairs/quick','/report-builder','/reports','/reports/iran','/reports/vat','/returns','/serials','/settings','/suppliers','/suppliers/new','/team','/warranty'];
async function login(browser,key,viaUi=false){
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  page.on('pageerror',error=>errors.push({actor:key,error:error.message}));
  page.on('response',response=>{if(response.status()>=500)errors.push({actor:key,status:response.status(),url:new URL(response.url()).pathname});});
  const actor=actors[key];
  if(viaUi){await page.goto(BASE+'/login');await page.locator('#email').fill(actor.email);await page.locator('#password').fill(actor.password);await page.locator('button[type=submit]').click();await page.waitForURL(url=>url.pathname!=='/login');}
  else{const response=await context.request.post(BASE+'/api/auth/login',{data:{email:actor.email,password:actor.password},headers:{origin:BASE}});check(`${key}: login`,response.status()===200,response.status());if(response.status()!==200)throw Error(`${key}: fixture login rejected (${response.status()})`);}
  await context.addCookies([{name:'repaid_branch',value:'all',url:BASE}]);
  return {context,page,actor};
}
async function capture(page,name){const filename=path.join(out,name+'.png');await page.screenshot({path:filename,fullPage:true});captures.push(path.relative(process.cwd(),filename));}
async function visit(page,key,url,foreignMarker){
  const html=foreignMarker?await (await page.request.get(BASE+url)).text():null;
  const response=await page.goto(BASE+url,{waitUntil:'domcontentloaded'});await page.waitForTimeout(80);
  check(`${key}: ${url}: no server failure`,response.status()<500,response.status());
  check(`${key}: ${url}: authenticated`,new URL(page.url()).pathname!=='/login');
  check(`${key}: ${url}: no streamed error boundary`,await page.getByRole('heading',{name:'مشکلی پیش آمد',exact:true}).count()===0);
  if(foreignMarker){check(`${key}: ${url}: no foreign SSR payload`,!html.includes(foreignMarker));check(`${key}: ${url}: no foreign visible records`,!(await page.locator('body').innerText()).includes(foreignMarker));}
  return response;
}
async function main(){
  const browser=await chromium.launch({executablePath:chrome(),headless:true});
  try{
    for(const key of ['owner','manager1','manager2']){
      const {context,page,actor}=await login(browser,key,key==='owner');
      const foreign=key==='owner'?null:sources[actor.branch_id===1?2:1].marker;
      for(const url of pages){
        const response=await visit(page,key,url,foreign);
        const allowed=canUser({user:actor},pagePermission(url));
        if(!allowed)check(`${key}: ${url}: protected page denied`,response.status()===404 || await page.getByRole('heading',{name:'صفحه در دسترس نیست',exact:true}).count()===1 || new URL(page.url()).pathname==='/');
        if(url==='/settings' && key!=='owner' && allowed){
          const controls=page.locator('fieldset[disabled]').first().locator('input,select,button,textarea');
          check(`${key}: company settings correctly shown read-only`,await controls.count()>0 && await controls.evaluateAll(elements=>elements.every(element=>element.matches(':disabled'))));
        }
      }
      if(key!=='owner'){
        const other=sources[actor.branch_id===1?2:1];
        for(const [prefix,id] of [['customers',other.customer],['devices',other.device],['repairs',other.ticket],['invoices',other.invoice],['purchase-orders',other.purchase]]){
          const target=`${BASE}/${prefix}/${id}`;
          const payload=await (await page.request.get(target)).text();
          const response=await page.goto(target);
          const denied=response.status()===404 || (response.status()===200 && await page.getByRole('heading',{name:'صفحه در دسترس نیست',exact:true}).count()===1);
          check(`${key}: foreign /${prefix}/${id} denied`,denied && !payload.includes(other.marker),response.status());
        }
        await page.goto(BASE+'/customers');check(`${key}: branch switcher hidden`,await page.getByLabel('انتخاب شعبه',{exact:true}).count()===0);
      }else{
        await page.goto(BASE+'/customers');
        for(const branch of [1,2]){
          await choose(page,'[aria-label="انتخاب شعبه"]',String(branch));
          await page.waitForFunction(value=>document.cookie.includes('repaid_branch='+value),String(branch));
          await page.goto(BASE+`/customers?q=${sources[branch].marker}`);check(`owner: selected branch ${branch} visible`,(await page.locator('body').innerText()).includes(sources[branch].marker));
          const response=await page.goto(`${BASE}/repairs/${sources[branch].ticket}`);check(`owner: branch ${branch} repair accessible`,response.status()===200,response.status());
        }
        await context.addCookies([{name:'repaid_branch',value:'all',url:BASE}]);
      }
      await context.close();
    }
    for(const branch of [1,2])for(const role of ['reception','technician','inventory','accountant','sales']){
      const key=`${role}${branch}`,{context,page}=await login(browser,key);
      for(const url of ['/','/chat',role==='inventory'?'/parts':role==='accountant'?'/invoices':role==='sales'?'/pos':'/repairs'])await visit(page,key,url,sources[branch===1?2:1].marker);
      await context.close();
    }
    const {context,page}=await login(browser,'manager1');
    await page.goto(BASE+'/chat');await page.getByRole('button',{name:'گفت‌وگوی جدید',exact:true}).first().click();
    await page.getByLabel('جستجوی کارمند',{exact:true}).fill('reception 1');
    await page.getByRole('button',{name:/کارمند آزمون reception 1/}).click();
    await page.getByRole('button',{name:'شروع گفت‌وگو',exact:true}).click();
    await page.getByLabel('متن پیام',{exact:true}).fill('پیام داخلی آزمون شعبه');
    const confirmed=page.waitForResponse(response=>response.url().includes('/messages')&&response.request().method()==='POST');
    await page.getByLabel('ارسال پیام',{exact:true}).click();check('Internal chat: server confirms send',(await confirmed).status()===200);
    await page.getByText('پیام داخلی آزمون شعبه',{exact:true}).first().waitFor();
    check('Internal chat: actual UI creation and confirmed send',true);
    await page.locator('#main-content aside').first().getByText('کارمند آزمون reception 1',{exact:true}).waitFor();
    check('Internal chat: new conversation appears in actual sidebar',true);
    const latest=db.prepare("SELECT m.id,c.branch_id FROM chat_messages m JOIN chat_conversations c ON c.id=m.conversation_id WHERE m.body=?").get('پیام داخلی آزمون شعبه');
    check('Internal chat: persisted branch-owned message',latest?.branch_id===1);
    const chatMain=page.locator('#main-content');
    check('Internal chat: no customer or linked-document UI',!(await chatMain.innerText()).match(/مشتری|پذیرش مرتبط|عملیاتی/));
    for(const theme of ['light','dark'])for(const width of [320,375,768,1440]){
      await page.evaluate(theme=>{document.documentElement.classList.toggle('dark',theme==='dark');},theme);
      await page.setViewportSize({width,height:900});await page.waitForTimeout(120);
      const size=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
      check(`Chat ${theme} ${width}: no page overflow`,size.scroll<=size.width+1,JSON.stringify(size));
      if(width<1280){
        check(`Chat ${theme} ${width}: no automatic info overlay`,await page.getByLabel('بستن پنل اطلاعات',{exact:true}).count()===0);
        const composer=await page.getByLabel('متن پیام',{exact:true}).boundingBox();
        check(`Chat ${theme} ${width}: composer remains on screen`,composer!=null&&composer.x>=0&&composer.x+composer.width<=width+1&&composer.y>=0&&composer.y+composer.height<=900);
      }
      await capture(page,`chat-${theme}-${width}`);
    }
    await page.setViewportSize({width:320,height:900});
    for(const url of ['/customers','/devices','/team','/complaints','/warranty','/reports','/serials','/labels','/outbox','/communication']){
      await visit(page,'manager1-mobile',url,sources[2].marker);
      const size=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
      check(`${url}: 320px page overflow`,size.scroll<=size.width+1,JSON.stringify(size));await capture(page,`mobile-${url.replaceAll('/','_')}`);
      if(url==='/customers'){
        const search=await page.locator('#main-content').getByRole('button',{name:'جستجو',exact:true}).boundingBox();
        check('Customers 320px: search button remains reachable',search!=null&&search.x>=0&&search.x+search.width<=321);
      }
      if(url==='/reports')check('Reports 320px: monetary cards do not clip',await page.locator('.kpi').evaluateAll(cards=>cards.every(card=>card.scrollWidth<=card.clientWidth+1)));
    }
    const verified=await context.request.post(BASE+'/api/track/verify',{data:{ticket:sources[1].marker+'-REPAIR',phone:'09128888881'},headers:{origin:BASE}});
    check('Tracking verification remains functional',verified.status()===200,verified.status());
    if(verified.ok()){
      const {token}=await verified.json();await page.goto(BASE+'/track/'+token);
      const content=await page.locator('body').innerText();check('Tracking: no customer message UI or leaked legacy messages',!content.includes('HIDDEN-LEGACY-CUSTOMER-MESSAGE')&&!content.includes('پیام خود را برای تعمیرگاه')&&await page.locator('textarea').count()===0);
      const blocked=await context.request.post(BASE+'/api/track/message',{data:{token,body:'BLOCKED'},headers:{origin:BASE}});check('Tracking valid token cannot send messages',blocked.status()===410,blocked.status());
      await capture(page,'tracking-internal-chat-disabled');
    }
    const management=await login(browser,'owner');
    const staff=actors.manager1,company=actors.owner;
    const oldDirect=await management.context.request.post(BASE+'/api/chat/conversations',{data:{type:'direct',user_id:staff.id},headers:{origin:BASE}});
    check('Transfer: company manager opens old-branch staff DM',oldDirect.status()===200,oldDirect.status());
    const oldId=(await oldDirect.json()).id;
    const oldGroup=await context.request.post(BASE+'/api/chat/conversations',{data:{type:'group',title:'گروه شعبهٔ نخست',member_ids:[company.id,actors.reception1.id]},headers:{origin:BASE}});
    check('Transfer: branch group created',oldGroup.status()===200,oldGroup.status());
    const groupId=(await oldGroup.json()).id;
    const transfer=await management.context.request.patch(BASE+`/api/users/${staff.id}`,{data:{branch_id:2},headers:{origin:BASE}});
    check('Transfer: company manager updates current employment',transfer.status()===200,transfer.status());
    check('Transfer: previous session invalidated',(await context.request.get(BASE+'/api/chat/conversations')).status()===401);
    const moved=await login(browser,'manager1');
    const currentCustomers=await moved.context.request.get(BASE+'/api/customers?q=TONIGHT-PRIVATE');
    const currentBody=await currentCustomers.text();check('Transfer: new session sees only new branch',currentBody.includes(sources[2].marker)&&!currentBody.includes(sources[1].marker));
    check('Transfer: old DM remains inaccessible',(await moved.context.request.get(BASE+`/api/chat/conversations/${oldId}/messages`)).status()===404);
    const noSend=await management.context.request.post(BASE+`/api/chat/conversations/${oldId}/messages`,{data:{body:'UNREACHABLE-OLD-BRANCH',client_key:crypto.randomUUID()},headers:{origin:BASE}});
    check('Transfer: old DM cannot falsely acknowledge unreachable recipient',noSend.status()===403,noSend.status());
    await management.page.goto(BASE+`/chat?c=${oldId}`);await management.page.getByText('شعبهٔ همکار تغییر کرده است؛ برای ادامه گفت‌وگوی جدیدی با او آغاز کنید.',{exact:true}).waitFor();
    await capture(management.page,'management-historical-dm-readonly');
    const sentSecret=await management.context.request.post(BASE+`/api/chat/conversations/${groupId}/messages`,{data:{body:'PRIVATE-BRANCH-ONE-AFTER-TRANSFER',mentions:[staff.id],client_key:crypto.randomUUID()},headers:{origin:BASE}});
    check('Transfer: remaining authorized member can post to old branch group',sentSecret.status()===200,sentSecret.status());
    const notifications=await (await moved.context.request.get(BASE+'/api/notifications')).text();check('Transfer: no old-branch notification preview leak',!notifications.includes('PRIVATE-BRANCH-ONE-AFTER-TRANSFER'));
    const newDirect=await moved.context.request.post(BASE+'/api/chat/conversations',{data:{type:'direct',user_id:company.id},headers:{origin:BASE}});
    check('Transfer: fresh management DM created',newDirect.status()===200,newDirect.status());
    const newId=(await newDirect.json()).id;check('Transfer: branch contexts keep separate immutable identities',newId!==oldId);
    await moved.page.goto(BASE+`/chat?c=${newId}`);await moved.page.getByLabel('متن پیام',{exact:true}).fill('گفت‌وگوی شعبهٔ جدید');
    const posted=moved.page.waitForResponse(response=>response.url().includes('/messages')&&response.request().method()==='POST');
    await moved.page.getByLabel('ارسال پیام',{exact:true}).click();check('Transfer: new branch message confirmed',(await posted).status()===200);
    check('Transfer: new message persisted in actual new branch',db.prepare("SELECT c.branch_id FROM chat_messages m JOIN chat_conversations c ON c.id=m.conversation_id WHERE m.body=? ORDER BY m.id DESC LIMIT 1").get('گفت‌وگوی شعبهٔ جدید')?.branch_id===2);
    await moved.page.setViewportSize({width:375,height:900});await capture(moved.page,'transferred-staff-new-dm-mobile');
    await moved.context.close();
    const restored=await management.context.request.patch(BASE+`/api/users/${staff.id}`,{data:{branch_id:1},headers:{origin:BASE}});check('Fixture employee restored through authorized API',restored.status()===200,restored.status());
    await management.context.close();
    await context.close();
  }finally{await browser.close();db.close();}
  check('No browser page errors or HTTP 5xx',errors.length===0,JSON.stringify(errors));
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({base:BASE,fixture:directory,results,errors,captures},null,2));
  console.log(JSON.stringify({checks:results.length,passed:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length,captures:captures.length,errors}));
  if(results.some(r=>!r.ok))process.exitCode=1;
}
main().catch(error=>{fs.writeFileSync(path.join(out,'interrupted.json'),JSON.stringify({error:error.stack,results,errors,captures},null,2));console.error(error.stack);try{db.close();}catch{}process.exitCode=1;});
