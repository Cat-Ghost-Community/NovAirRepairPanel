const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite'),{chromium}=require('playwright-core');
const base=process.env.BASE_URL||'http://127.0.0.1:3002',filename=path.resolve(process.env.E2E_DB||'');
if(process.env.FINANCIAL_BROWSER_MUTATIONS!=='1'||!['127.0.0.1','localhost'].includes(new URL(base).hostname)||!filename.startsWith(path.resolve('.freebuff')+path.sep))throw new Error('Explicit disposable localhost database required');
const prepared=spawnSync(process.execPath,['--import','tsx','scripts/returns-browser-fixture.ts'],{env:{...process.env,V6_RETURN_BROWSER:'1'},encoding:'utf8',windowsHide:true});if(prepared.status!==0)throw new Error(prepared.stderr);
const f=JSON.parse(fs.readFileSync('.freebuff/returns-browser-fixture.json','utf8'));
(async()=>{
 const db=new DatabaseSync(filename,{readOnly:true}),browser=await chromium.launch({channel:'chrome',headless:true}),evidence={checks:[],captures:[],errors:[]};
 const check=(name,pass)=>{evidence.checks.push({name,pass});if(!pass)throw new Error(name);};
 try{
  const login=async(email,password)=>{const c=await browser.newContext({locale:'fa-IR',viewport:{width:1440,height:1000}});const r=await c.request.post(base+'/api/auth/login',{headers:{origin:base},data:{email,password}});check('real login '+email,r.ok());await c.addCookies([{name:'repaid_branch',value:String(f.branch),url:base}]);return c;};
  const owner=await login('owner@repaid.local','demo1234'),approver=await login(f.email,'fixture-return-approval-2026'),page=await owner.newPage(),review=await approver.newPage();
  for(const p of [page,review])p.on('pageerror',e=>evidence.errors.push(e.message));
  const act=async(p,label,action)=>{const pending=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/returns'&&r.request().method()==='POST'&&r.request().postDataJSON().action===action);await p.getByRole('button',{name:label,exact:true}).click();const response=await pending,data=await response.json();if(!response.ok())throw new Error(`${action}: ${data.error}`);await p.waitForLoadState('networkidle');return data;};
  const capture=async(label)=>{await page.waitForTimeout(3500);for(const theme of ['light','dark'])for(const width of [320,375,390,430,768,1024,1280,1440,1920]){await page.setViewportSize({width,height:1000});await page.evaluate(t=>document.documentElement.classList.toggle('dark',t==='dark'),theme);await page.getByRole('button',{name:'صورتحساب طرف معامله در این شعبه',exact:true}).scrollIntoViewIfNeeded();check(`${label} ${theme} ${width} no document overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const file=`.freebuff/v6-${label}-${theme}-${width}.png`;await page.screenshot({path:file,fullPage:true});evidence.captures.push(file);}await page.setViewportSize({width:1440,height:1000});};
  const physical=async(source,qty,label)=>{
   await page.goto(`${base}/returns?invoice_id=${source.id}`,{waitUntil:'networkidle'});
   if(label==='fraction-0'){
    const picker=page.getByLabel('انتخاب فاکتور؛ جست‌وجو با شماره یا نام طرف حساب',{exact:true}),widget=picker.locator('..');
    await widget.getByRole('button',{name:'جست‌وجو و موارد بیشتر',exact:true}).click();await page.waitForLoadState('networkidle');
    const number=db.prepare('SELECT number FROM invoices WHERE id=?').get(source.id).number;await widget.locator('input').fill(number);await widget.getByRole('button',{name:'جست‌وجو',exact:true}).click();await page.waitForLoadState('networkidle');await picker.selectOption(String(source.id));check('searched original invoice selected through actual UI',await picker.inputValue()===String(source.id));
   }
   await page.locator(`#return-quantity-${source.line}`).fill(String(qty));await page.locator('#return-delivery').fill('رسید واقعی تحویل اصلی در سناریوی مستقل');await page.locator('#return-reason').fill(`درخواست واقعی سناریوی جدا ${label}`);const result=await act(page,'ثبت درخواست','request');
   if(qty===0.333333){await page.getByText('۰.۳۳۳۳۳۳',{exact:true}).waitFor({state:'visible'});check('six-digit fractional quantity stays visible',await page.getByText('۰.۳۳۳۳۳۳',{exact:true}).isVisible());}
   await act(page,'صدور مجوز مرجوعی','authorize');await page.locator('#return-receipt').fill('رسید امضاشدهٔ دریافت واقعی کالا');await act(page,'ثبت رسید واقعی','receive');
   const line=Number(db.prepare('SELECT id FROM business_return_lines WHERE return_id=?').get(result.id).id);
   await page.locator(`#disposition-${line}`).selectOption('restock');await page.locator(`#return-location-${line}`).selectOption(String(f.location));await page.locator(`#inspection-note-${line}`).fill('کالای سالم به‌صورت واقعی بازرسی شد');await page.locator('#return-inspection-reference').fill('مرجع مستقل گزارش واقعی بازرسی');await act(page,'ثبت بازرسی','inspect');
   await page.locator('#return-disposition-proof').fill('رسید واقعی انبار برای کالای برگشتی');await page.getByLabel('انجام واقعی و مدارک تعیین تکلیف را بررسی کرده‌ام.').check();await act(page,'اجرای تعیین تکلیف کالا','dispose');return {id:result.id,line};
  };
  const approve=async(r,amount,reason)=>{
   await page.locator(`#credit-net-${r.line}`).fill(String(amount));await page.locator('#credit-reason').fill(reason);await page.locator('#credit-evidence').fill('مدرک بازبینی مستقل مبلغ و مالیات صفر');await act(page,'ثبت پیش‌نویس اعتبارنامه','propose_credit');
   check('self-approval disabled',await page.getByRole('button',{name:'تأیید مستقل اعتبارنامه',exact:true}).isDisabled());await review.goto(`${base}/returns?return_id=${r.id}`,{waitUntil:'networkidle'});await act(review,'تأیید مستقل اعتبارنامه','approve_credit');await page.reload({waitUntil:'networkidle'});
  };
  for(let i=0;i<3;i++){
   const r=await physical(f.full,[0.333333,0.333333,0.333334][i],`fraction-${i}`);await approve(r,100,'تأیید سهم دقیق برگشت بر اساس سند اصلی');
   check(`fraction ${i} exact immutable cost`,db.prepare('SELECT cost_amount FROM business_return_lines WHERE id=?').get(r.line).cost_amount===[33,34,33][i]);
   await page.locator('#return-refund-payment').selectOption(String(f.full.payment));await page.locator('#return-refund-amount').fill('100');await page.locator('#return-refund-reference').fill(`سند وجه واقعی بخش کسری ${i}`);await page.getByLabel('انجام وجه و مرجع آن را بررسی کرده‌ام.').check();await act(page,'ثبت سند استرداد انجام‌شده','refund');
   check(`fraction ${i} completed`,db.prepare('SELECT state FROM business_returns WHERE id=?').get(r.id).state==='completed');if(i===2)await capture('fractional');
  }
  const r=await physical(f.partial,1,'replacement');await approve(r,300,'اعتبار مستند اصلی پیش از بررسی مجدد');
  const originalNote=db.prepare('SELECT id FROM credit_notes WHERE return_id=?').get(r.id).id,stock=db.prepare('SELECT qty FROM inventory_stock WHERE part_id=? AND location_id=?').get(f.part,f.location).qty;
  await page.getByText('برگشت مالی اعتبارنامه؛ موجودی خودکار تغییر نمی‌کند',{exact:true}).click();await page.locator('#credit-reversal-reason').fill('دلیل مستند برگشت و بازصدور کنترل‌شده');await page.getByLabel('اثر اصلاح بر بدهی را بررسی کرده‌ام؛ پرداخت و موجودی واقعی پاک نمی‌شوند.').check();await act(page,'ثبت برگشت مالی اعتبارنامه','reverse_credit');
  await approve(r,300,'بازصدور پس از برگشت با تأیید تازهٔ مبلغ');const notes=db.prepare('SELECT id,status,replaces_note_id FROM credit_notes WHERE return_id=? ORDER BY id').all(r.id);
  check('reissue retains original reversed and replacement lineage',notes.length===2&&notes[0].status==='reversed'&&notes[1].status==='posted'&&notes[1].replaces_note_id===originalNote);
  check('reissue never repeats physical stock',db.prepare('SELECT qty FROM inventory_stock WHERE part_id=? AND location_id=?').get(f.part,f.location).qty===stock&&db.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE ref_type='business_return' AND ref_id=?").get(r.line).n===1);
  await page.getByText('سوابق اعتبارنامه و بازصدور',{exact:true}).click();check('both immutable credit versions visible',await page.getByRole('link',{name:db.prepare('SELECT number FROM credit_notes WHERE id=?').get(originalNote).number,exact:true}).count()>0);await capture('reissue');
  const balance=code=>Number(db.prepare("SELECT COALESCE(SUM(l.debit-l.credit),0) n FROM accounting_lines l JOIN accounting_journals j ON j.id=l.journal_id WHERE j.branch_id=? AND j.state IN ('posted','reversed') AND l.account_code=?").get(f.branch,code).n);
  for(const [code,value] of Object.entries({'1000':700,'1100':600,'1110':700,'2000':0,'4000':-600,'5000':200}))check('exact mixed branch balance '+code,balance(code)===value);
  const pl=await owner.request.get(base+'/api/reports/iran?type=pl');check('mixed recognized profit 400',pl.ok()&&(await pl.json()).net===400);
  check('all branch journals balanced',db.prepare("SELECT j.id FROM accounting_journals j JOIN accounting_lines l ON l.journal_id=j.id WHERE j.branch_id=? AND j.state IN ('posted','reversed') GROUP BY j.id HAVING SUM(l.debit)!=SUM(l.credit)").all(f.branch).length===0);
  await page.goto(`${base}/returns?invoice_id=${f.full.id}`,{waitUntil:'networkidle'});
  const sourcePicker=page.getByLabel('انتخاب فاکتور؛ جست‌وجو با شماره یا نام طرف حساب',{exact:true}),searchWidget=sourcePicker.locator('..');
  await searchWidget.getByRole('button',{name:'جست‌وجو و موارد بیشتر',exact:true}).click();await page.waitForLoadState('networkidle');
  await searchWidget.locator('input').fill(`no-match-${f.nonce}`);await searchWidget.getByRole('button',{name:'جست‌وجو',exact:true}).click();await searchWidget.getByText('گزینه‌ای یافت نشد',{exact:true}).waitFor();check('empty search uses the real empty state',await searchWidget.getByText('گزینه‌ای یافت نشد',{exact:true}).isVisible());
  await page.route('**/api/returns?view=selector**',route=>route.abort());await searchWidget.locator('input').fill(db.prepare('SELECT number FROM invoices WHERE id=?').get(f.full.id).number);await searchWidget.getByRole('button',{name:'جست‌وجو',exact:true}).click();await searchWidget.getByRole('alert').waitFor();
  check('network failure is actionable Persian',await searchWidget.getByRole('alert').textContent().then(text=>text.includes('اتصال')&&!text.includes('Failed to fetch')));
  await page.unroute('**/api/returns?view=selector**');await searchWidget.getByRole('button',{name:'دریافت دوباره',exact:true}).click();await sourcePicker.locator(`option[value="${f.full.id}"]`).waitFor({state:'attached'});await sourcePicker.selectOption(String(f.full.id));check('selector recovers by retry without a financial mutation',await sourcePicker.inputValue()===String(f.full.id));
  await page.goto(base+'/parts/new',{waitUntil:'networkidle'});await page.locator('#part-quantity-precision').selectOption('2');
  for(const theme of ['light','dark'])for(const width of [320,375,390,430,768,1024,1280,1440,1920]){
   await page.setViewportSize({width,height:1000});await page.evaluate(t=>document.documentElement.classList.toggle('dark',t==='dark'),theme);await page.waitForTimeout(300);
   check(`precision ${theme} ${width} no document overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const file=`.freebuff/v6-precision-${theme}-${width}.png`;await page.screenshot({path:file,fullPage:true});evidence.captures.push(file);
  }
  await page.locator('#nm').fill(`کالای دقت‌دار ${f.nonce}`);await page.locator('#pp').fill('100');await page.getByLabel(/قیمت فروش/).fill('100');
  const saved=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/parts'&&r.request().method()==='POST');await page.getByRole('button',{name:'ایجاد کالا',exact:true}).click();const response=await saved,created=await response.json();check('real item creation succeeds',response.ok());await page.waitForURL(`**/parts/${created.id}`);
  check('chosen item precision persists',db.prepare('SELECT quantity_precision FROM parts WHERE id=?').get(created.id).quantity_precision===2);
  const invalidName=`Invalid precision ${f.nonce}`,invalid=await owner.request.post(base+'/api/parts',{headers:{origin:base,'idempotency-key':crypto.randomUUID()},data:{name:invalidName,quantity_precision:2,opening_qty:0.001,purchase_price:100,price:100}});
  check('invalid opening precision is rejected without a partial product',invalid.status()===400&&db.prepare('SELECT COUNT(*) n FROM parts WHERE name=?').get(invalidName).n===0);
  check('no browser runtime errors',evidence.errors.length===0);
 }finally{fs.writeFileSync('.freebuff/v6-returns-browser.json',JSON.stringify(evidence,null,2));db.close();await browser.close();}
 console.log(`V6 return checks ${evidence.checks.length}; captures ${evidence.captures.length}`);
})().catch(e=>{console.error(e);process.exitCode=1;});
