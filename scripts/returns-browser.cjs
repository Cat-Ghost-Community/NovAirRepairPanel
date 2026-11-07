const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const {chromium}=require('playwright-core');
const base=process.env.BASE_URL||'http://127.0.0.1:3002',filename=path.resolve(process.env.E2E_DB||'');
if(process.env.FINANCIAL_BROWSER_MUTATIONS!=='1'||!['127.0.0.1','localhost'].includes(new URL(base).hostname)||!filename.startsWith(path.resolve('.freebuff')+path.sep))throw new Error('Explicit disposable localhost database required');
const prepared=spawnSync(process.execPath,['--import','tsx','scripts/returns-browser-fixture.ts'],{env:process.env,encoding:'utf8',windowsHide:true});
if(prepared.status!==0)throw new Error(prepared.stderr);
const f=JSON.parse(fs.readFileSync('.freebuff/returns-browser-fixture.json','utf8'));
(async()=>{
 const db=new DatabaseSync(filename,{readOnly:true}),browser=await chromium.launch({channel:'chrome',headless:true});
 const evidence={checks:[],captures:[],errors:[],fixture:f.nonce};
 const check=(name,pass)=>{evidence.checks.push({name,pass});if(!pass)throw new Error(name);};
 try{
  const login=async(email,password)=>{const context=await browser.newContext({locale:'fa-IR',viewport:{width:1440,height:1000}});const response=await context.request.post(base+'/api/auth/login',{headers:{origin:base},data:{email,password}});check('real login '+email,response.ok());await context.addCookies([{name:'repaid_branch',value:String(f.branch),url:base}]);return context;};
  const owner=await login('owner@repaid.local','demo1234'),approver=await login(f.email,'fixture-return-approval-2026');
  const page=await owner.newPage(),reviewer=await approver.newPage();
  for(const p of [page,reviewer])p.on('pageerror',error=>evidence.errors.push(error.message));
  const act=async(p,name,action)=>{const response=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/returns'&&r.request().method()==='POST'&&r.request().postDataJSON().action===action);await p.getByRole('button',{name,exact:true}).click();const r=await response,data=await r.json();if(!r.ok())throw new Error(`${action}: ${data.error}`);await p.waitForLoadState('networkidle');return data;};
  const capture=async(label,focus)=>{await page.waitForTimeout(3500);for(const theme of ['light','dark'])for(const width of [320,375,390,430,768,1024,1280,1440,1920]){await page.setViewportSize({width,height:1000});await page.evaluate(t=>document.documentElement.classList.toggle('dark',t==='dark'),theme);if(focus)await page.locator(focus).scrollIntoViewIfNeeded();await page.waitForTimeout(300);const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);check(`${label} ${theme} ${width}px no document overflow`,!overflow);const target=`.freebuff/returns-${label}-${theme}-${width}.png`;await page.screenshot({path:target,fullPage:true});evidence.captures.push(target);}await page.setViewportSize({width:1440,height:1000});};
  const workflow=async(source,disposition,amount,refund,label)=>{
   await page.goto(`${base}/returns?invoice_id=${source.id}`,{waitUntil:'networkidle'});
   await page.locator(`#return-quantity-${source.line}`).fill('1');await page.locator('#return-delivery').fill('رسید تحویل واقعی سناریوی مستقل');await page.locator('#return-reason').fill('درخواست مستند برگشت کالا در آزمون مستقل');
   if(label==='full')await capture('request');
   const requested=await act(page,'ثبت درخواست','request'),id=requested.id;
   await act(page,'صدور مجوز مرجوعی','authorize');
   const supplier=label==='supplier';
   if(!supplier){await page.locator('#return-receipt').fill('رسید واقعی دریافت فیزیکی مشتری');await act(page,'ثبت رسید واقعی','receive');}
   const line=Number(db.prepare('SELECT id FROM business_return_lines WHERE return_id=?').get(id).id);
   await page.locator(`#disposition-${line}`).selectOption(disposition);
   if(disposition==='restock'||disposition==='supplier')await page.locator(`#return-location-${line}`).selectOption(String(f.location));
   await page.locator(`#inspection-note-${line}`).fill('وضعیت واقعی کالا بررسی و مستند شد');await page.locator('#return-inspection-reference').fill('مرجع گزارش امضاشدهٔ بازرسی');await act(page,'ثبت بازرسی','inspect');
   if(label==='full')await capture('inspection','#return-disposition-proof');
   await page.locator('#return-disposition-proof').fill('سند واقعی تعیین تکلیف و ثبت انبار');
   await page.getByLabel('انجام واقعی و مدارک تعیین تکلیف را بررسی کرده‌ام.').check();await act(page,supplier?'ثبت خروج واقعی کالا':'اجرای تعیین تکلیف کالا','dispose');
   if(supplier){await page.locator('#return-receipt').fill('رسید امضاشدهٔ تأمین‌کننده پس از خروج');await act(page,'ثبت رسید واقعی','receive');}
   await page.locator(`#credit-net-${line}`).fill(String(amount));await page.locator('#credit-reason').fill('مبلغ دقیق اصلاح تعهد بر اساس اصل فاکتور');await page.locator('#credit-evidence').fill('مدرک مستقل تأیید مبلغ و مالیات صفر');await act(page,'ثبت پیش‌نویس اعتبارنامه','propose_credit');
   check(label+' cannot approve own credit',await page.getByRole('button',{name:'تأیید مستقل اعتبارنامه',exact:true}).isDisabled());
   await reviewer.goto(`${base}/returns?return_id=${id}`,{waitUntil:'networkidle'});await act(reviewer,'تأیید مستقل اعتبارنامه','approve_credit');
   await page.reload({waitUntil:'networkidle'});
   check(label+' completion is persisted',db.prepare('SELECT state FROM business_returns WHERE id=?').get(id).state==='completed');
   check(label+' actual posted credit',db.prepare('SELECT status,amount FROM credit_notes WHERE return_id=?').get(id).status==='posted');
   if(refund){await page.locator('#return-refund-payment').selectOption(String(source.payment));await page.locator('#return-refund-amount').fill(String(amount));await page.locator('#return-refund-reference').fill(`سند نقدی واقعی مستقل ${label}`);await page.getByLabel('انجام وجه و مرجع آن را بررسی کرده‌ام.').check();await act(page,'ثبت سند استرداد انجام‌شده','refund');check(label+' one actual refund',db.prepare('SELECT SUM(amount) n FROM return_settlements WHERE return_id=?').get(id).n===amount);}
   await page.getByRole('button',{name:'صورتحساب طرف معامله در این شعبه',exact:true}).click();await page.getByText('ماندهٔ مستند:',{exact:false}).waitFor();
   if(label==='full'||supplier)await capture(label+'-settled','#return-refund-reference');
   check(label+' original gross remains immutable',db.prepare('SELECT total FROM invoices WHERE id=?').get(source.id).total===(supplier?300:label==='partial'?600:300));
   return id;
  };
  await workflow(f.full,'restock',300,true,'full');await workflow(f.partial,'restock',300,false,'partial');await workflow(f.damaged,'damaged',300,false,'damaged');await workflow(f.purchase,'supplier',100,true,'supplier');
  const balance=code=>Number(db.prepare("SELECT COALESCE(SUM(l.debit-l.credit),0) n FROM accounting_lines l JOIN accounting_journals j ON j.id=l.journal_id WHERE j.branch_id=? AND j.state IN ('posted','reversed') AND l.account_code=?").get(f.branch,code).n);
  for(const [code,amount] of Object.entries({'1000':800,'1100':300,'1110':600,'1310':0,'2000':0,'4000':-300,'5000':100,'6020':100}))check('exact final account '+code,balance(code)===amount);
  check('exact final stock six',db.prepare('SELECT qty FROM inventory_stock WHERE part_id=? AND location_id=?').get(f.part,f.location).qty===6);
  check('every posted journal balances',db.prepare("SELECT j.id FROM accounting_journals j JOIN accounting_lines l ON l.journal_id=j.id WHERE j.branch_id=? AND j.state IN ('posted','reversed') GROUP BY j.id HAVING SUM(l.debit)!=SUM(l.credit)").all(f.branch).length===0);
  await page.goto(`${base}/customers/${f.customer}`,{waitUntil:'networkidle'});
  check('customer page excludes another branch invoice and financial timeline',!await page.getByText(f.foreignNumber,{exact:false}).count());
  for(const type of ['ar_ap','journal','pl','stock_value']){
   const response=await owner.request.get(`${base}/api/reports/iran?type=${type}`);check('real financial report '+type,response.ok());if(!response.ok())throw new Error(await response.text());
   const data=await response.json();
   if(type==='pl')check('recognized profit is exactly 100, not collections',data.net===100);
   if(type==='stock_value')check('operational and ledger inventory both equal 600',data.totals.cost===600&&data.ledger_value===600&&data.difference===0);
   if(type==='ar_ap')check('customer owes 300 and supplier owes zero',data.debtors.find(r=>r.id===f.customer)?.balance===300&&!data.supplier_debts.some(r=>r.id===f.supplier));
  }
  check('no browser runtime errors',evidence.errors.length===0);
 }finally{fs.writeFileSync('.freebuff/returns-browser-evidence.json',JSON.stringify(evidence,null,2));db.close();await browser.close();}
 console.log(`Returns browser checks: ${evidence.checks.length}; screenshots: ${evidence.captures.length}`);
})().catch(error=>{console.error(error);process.exitCode=1;});
