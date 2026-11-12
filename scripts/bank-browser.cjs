// Real compiled banking form acceptance; disposable fixture and explicit mode only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright-core'),{choose}=require('./browser-select.cjs');
const fixture=JSON.parse(fs.readFileSync('.qa-work/fixture-20.json','utf8')),directory=fs.realpathSync(fixture.directory),phase=process.env.BANK_QA_PHASE==='baseline'?'baseline':'after';
if(process.env.BANK_QA_MODE!=='1'||!directory.startsWith(fs.realpathSync('.qa-work/fixtures')+path.sep))throw Error('Explicit isolated bank fixture required');
require('./test-environment.cjs');process.env.REPAID_DATA_DIR=directory;process.env.REPAID_DEMO_MODE='0';
const {getDb,DB_PATH}=require('../src/lib/db/schema.ts');assert.equal(DB_PATH,path.join(directory,'repaid.db'));
const db=getDb(),out='.qa-work/bank-browser',BASE='http://127.0.0.1:3002',MAX=Number.MAX_SAFE_INTEGER,AMOUNT=9007199254740987,checks=[],captures=[],errors=[];fs.mkdirSync(out,{recursive:true});
const record=path.join(out,'fixture.json');let accounts;
if(phase==='baseline'){
 db.exec('BEGIN IMMEDIATE');try{db.prepare("INSERT INTO settings(key,value) VALUES('currency_unit','toman') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();db.exec('UPDATE bank_accounts SET is_active=0');
  const insert=db.prepare('INSERT INTO bank_accounts(name,current_balance,is_active) VALUES(?,?,1)');accounts={directory,from:Number(insert.run('BANK-QA-SOURCE',MAX).lastInsertRowid),to:Number(insert.run('BANK-QA-TARGET',0).lastInsertRowid)};db.exec('COMMIT');fs.writeFileSync(record,JSON.stringify(accounts));
 }catch(error){db.exec('ROLLBACK');throw error;}
}else{accounts=JSON.parse(fs.readFileSync(record,'utf8'));assert.equal(accounts.directory,directory);}
const check=(name,value)=>{assert.ok(value,name);checks.push(name);},balances=()=>[accounts.from,accounts.to].map(id=>db.prepare('SELECT current_balance FROM bank_accounts WHERE id=?').get(id).current_balance);
(async()=>{let browser;try{
 const cache=path.join(process.env.LOCALAPPDATA,'ms-playwright'),exe=fs.readdirSync(cache).filter(n=>n.startsWith('chromium-')).sort((a,b)=>Number(b.split('-')[1])-Number(a.split('-')[1])).map(n=>path.join(cache,n,'chrome-win64/chrome.exe')).find(fs.existsSync);browser=await chromium.launch({executablePath:exe,headless:true});const context=await browser.newContext(),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 const login=await context.request.post(BASE+'/api/auth/login',{data:{email:'owner@repaid.local',password:'demo1234'},headers:{origin:BASE}});check('Owner logs in through the real server',login.status()===200);
 const frames=[];
 for(const width of [320,375,768,1440])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:1000});await page.goto(BASE+'/bank',{waitUntil:'networkidle'});await page.evaluate(theme=>{localStorage.setItem('theme',theme);document.documentElement.classList.toggle('dark',theme==='dark');},theme);
  await page.getByRole('button',{name:/انتقال بین حساب/}).click();const modal=page.getByRole('dialog');await modal.waitFor();const rect=await modal.boundingBox();frames.push({width,theme,rect});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
  if(phase==='after'){check('Bank modal has no horizontal page overflow '+width+' '+theme,!overflow);check('Exact large balance remains inside its card '+width+' '+theme,await page.locator('.kpi-value').evaluate(e=>e.scrollWidth<=e.clientWidth+1));}
  const file=out+'/'+phase+'-'+width+'-'+theme+'.png';await page.screenshot({path:file,fullPage:true});captures.push(file);
 }
 if(phase==='after'){
  const baseline=JSON.parse(fs.readFileSync(path.join(out,'baseline.json'),'utf8'));
  check('Approved modal frame is preserved',frames.every((frame,index)=>Math.abs(frame.rect.width-baseline.frames[index].rect.width)<2&&Math.abs(frame.rect.height-baseline.frames[index].rect.height)<2));
  await page.setViewportSize({width:375,height:1000});await page.goto(BASE+'/bank',{waitUntil:'networkidle'});await page.getByRole('button',{name:/انتقال بین حساب/}).click();const modal=page.getByRole('dialog');
  await choose(page,'#bank-transfer-from',accounts.from);await choose(page,'#bank-transfer-to',accounts.to);check('Visible searchable selectors retain accessible labels',await page.getByRole('combobox',{name:'از حساب',exact:true}).count()>0&&await page.getByRole('combobox',{name:'به حساب',exact:true}).count()>0);
  await modal.getByLabel('مبلغ (تومان)',{exact:true}).fill('900719925474098.7');await modal.getByLabel('توضیحات',{exact:true}).fill('BANK-QA-EXACT-RIAL');
  const request=page.waitForRequest(r=>r.url().endsWith('/api/bank')&&r.method()==='POST'),response=page.waitForResponse(r=>r.url().endsWith('/api/bank')&&r.request().method()==='POST');await modal.getByRole('button',{name:'ثبت انتقال',exact:true}).click();const sent=await request,received=await response,payload=sent.postDataJSON(),result=await received.json();
  check('Browser preserves the final rial before server submission',payload.amount===AMOUNT);check('Actual server confirms the persisted register transfer',received.status()===200&&result.ok===true);check('Exact source and destination balances conserve every rial',JSON.stringify(balances())===JSON.stringify([4,AMOUNT]));
  await page.getByText('انتقال ثبت شد',{exact:true}).first().waitFor();check('Confirmation describes registration rather than external execution',true);
  const key=sent.headers()['idempotency-key'],before=db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n;
  const replay=await context.request.post(BASE+'/api/bank',{data:payload,headers:{origin:BASE,'idempotency-key':key}});check('Real server retry uses the same durable result',replay.status()===200&&JSON.stringify(await replay.json())===JSON.stringify(result)&&db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n===before);
  const changed=await context.request.post(BASE+'/api/bank',{data:{...payload,amount:AMOUNT-1},headers:{origin:BASE,'idempotency-key':key}});check('Changed payload conflicts without another movement',changed.status()===409&&db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n===before);
  const event=db.prepare("SELECT id FROM accounting_events WHERE event_key=?").get('bank:'+result.id+':transfer_out'),journals=db.prepare('SELECT COUNT(*) n FROM accounting_journals').get().n;
  const review=await context.request.post(BASE+'/api/accounting',{data:{action:'review_event',id:event.id,posting_date:new Date().toISOString().slice(0,10),reason:'Unpaired bank transfer must not become revenue',lines:[{account_code:'1020',bank_account_id:accounts.to,debit:AMOUNT},{account_code:'4000',credit:AMOUNT}]},headers:{origin:BASE,'idempotency-key':'bank-qa-review-block-0001'}});
  const reviewBody=await review.json();check('Direct accounting API blocks independent transfer-leg recognition',review.status()===409&&String(reviewBody.error).includes('ثبت واحد دو گردش')&&db.prepare('SELECT COUNT(*) n FROM accounting_journals').get().n===journals);
  await page.getByRole('button',{name:/انتقال بین حساب/}).click();const retry=page.getByRole('dialog');await choose(page,'#bank-transfer-from',accounts.from);await choose(page,'#bank-transfer-to',accounts.to);
  await retry.getByLabel('مبلغ (تومان)',{exact:true}).fill('0.01');let invalidRequests=0;const onRequest=r=>{if(r.url().endsWith('/api/bank')&&r.method()==='POST')invalidRequests++;};page.on('request',onRequest);await retry.getByRole('button',{name:'ثبت انتقال',exact:true}).click();await page.getByText('مبلغ تومان باید صحیح یا دارای یک رقم اعشار باشد.',{exact:true}).first().waitFor();page.off('request',onRequest);check('Fractional-rial input never reaches the server',invalidRequests===0&&db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n===before);
  await retry.getByLabel('مبلغ (تومان)',{exact:true}).fill('1');const rejected=page.waitForResponse(r=>r.url().endsWith('/api/bank')&&r.request().method()==='POST');await retry.getByRole('button',{name:'ثبت انتقال',exact:true}).click();check('Server rejects overflowing destination balance',(await rejected).status()===400);await page.getByText('ماندهٔ حساب خارج از محدودهٔ مجاز است.',{exact:true}).first().waitFor();check('Failure preserves both balances and leaves an actionable form',JSON.stringify(balances())===JSON.stringify([4,AMOUNT])&&await retry.getByRole('button',{name:'ثبت انتقال',exact:true}).isEnabled());
  const file=out+'/after-confirmed-failure-375.png';await page.screenshot({path:file,fullPage:true});captures.push(file);
  // Independent expected aggregate: MAX_SAFE_INTEGER + (MAX_SAFE_INTEGER-1).
  db.prepare('INSERT INTO bank_accounts(name,current_balance,is_active) VALUES(?,?,1)').run('BANK-QA-EXACT-TOTAL',MAX-1);
  await page.goto(BASE+'/bank',{waitUntil:'networkidle'});check('Company total preserves every rial beyond the per-document numeric range',(await page.locator('.kpi-value').innerText())==='۱,۸۰۱,۴۳۹,۸۵۰,۹۴۸,۱۹۸.۱ تومان');
  const aggregate=await (await context.request.get(BASE+'/api/bank')).json();check('Bank API agrees on exact consolidated rial without numeric rounding',aggregate.total===null&&aggregate.total_exact==='18014398509481981'&&aggregate.total_state==='exceeds_number_range');
  await page.setViewportSize({width:320,height:1000});check('Large consolidated total remains within its card',await page.locator('.kpi-value').evaluate(e=>e.scrollWidth<=e.clientWidth+1));const totalFile=out+'/after-exact-total-320.png';await page.screenshot({path:totalFile,fullPage:true});captures.push(totalFile);
  db.prepare('INSERT INTO bank_accounts(name,current_balance,is_active) VALUES(?,NULL,1)').run('BANK-QA-UNKNOWN-BALANCE');await page.reload({waitUntil:'networkidle'});check('Unknown cached balances are not silently substituted with zero',(await page.locator('.kpi-value').innerText())==='نیازمند بررسی مانده');await page.getByRole('button',{name:/انتقال بین حساب/}).click();check('Unknown balances cannot be selected for another transfer',await page.locator('#bank-transfer-from option').filter({hasText:'BANK-QA-UNKNOWN-BALANCE'}).isDisabled());
  db.prepare("UPDATE bank_accounts SET is_active=0 WHERE name IN ('BANK-QA-EXACT-TOTAL','BANK-QA-UNKNOWN-BALANCE')").run();
 }
 check('No browser runtime errors',errors.length===0);fs.writeFileSync(out+'/'+phase+'.json',JSON.stringify({phase,checks:checks.length,passed:checks,captures,frames,errors},null,2));console.log(JSON.stringify({phase,checks:checks.length,captures:captures.length,errors}));
}finally{if(browser)await browser.close();db.close();}})().catch(error=>{console.error(error.stack);process.exitCode=1;});
