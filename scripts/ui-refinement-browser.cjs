// Isolated browser review; optional fixture writes require UI_REFINE_MUTATIONS=1.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { chromium } = require('playwright-core');
const BASE = 'http://127.0.0.1:3002';
const phase = process.env.UI_PHASE === 'baseline' ? 'baseline' : 'after';
const fixture = JSON.parse(fs.readFileSync('.freebuff/fixture-20.json','utf8'));
const fixtureDirectory = fs.realpathSync(fixture.directory);
assert.ok(fixtureDirectory.startsWith(fs.realpathSync('.freebuff/fixtures')+path.sep),'Browser QA requires a disposable fixture');
const db = new DatabaseSync(path.join(fixtureDirectory,'repaid.db'),{readOnly:true});
const finances = () => Object.fromEntries(['invoices','payments','refunds','inventory_stock','inventory_movements','accounting_journals','accounting_lines'].map(table=>[table,crypto.createHash('sha256').update(JSON.stringify(db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())).digest('hex')]));
const originalFinances = finances();
const out = `.freebuff/ui-refinement/${phase}`;
fs.mkdirSync(out, { recursive: true });
const cache = path.join(process.env.LOCALAPPDATA, 'ms-playwright');
const exe = fs.readdirSync(cache).filter(n => n.startsWith('chromium-')).sort((a,b) => Number(b.split('-')[1])-Number(a.split('-')[1])).map(n => path.join(cache,n,'chrome-win64/chrome.exe')).find(p => fs.existsSync(p)) || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
let browser;
(async () => {
 browser = await chromium.launch({executablePath: exe});
 const context = await browser.newContext({viewport:{width:1440,height:1000},locale:'fa-IR'});
 const errors = [];
 const page = await context.newPage();
 page.on('pageerror', e => errors.push(e.message));
 assert.equal((await context.request.post(`${BASE}/api/auth/login`,{data:{email:'owner@repaid.local',password:'demo1234'}})).status(),200);
 // The assignment picker scenario needs the seeded branch with active technicians,
 // not a newer acceptance branch deliberately created without any technicians.
 await context.addCookies([{name:'repaid_branch',value:'1',url:BASE}]);
 const checks=[];
 const interactions=[];
 const check=(name,condition)=>{assert.ok(condition,name);interactions.push(name);};
 for(const width of [320,375,768,1440]) {
  await page.setViewportSize({width,height:1000});
  for(const route of ['/repairs/assignment','/repairs/board','/devices','/daily-report']) {
   await page.goto(`${BASE}${route}`,{waitUntil:'networkidle'});
   await page.screenshot({path:`${out}/${route.replaceAll('/','-')}-${width}.png`,fullPage:true});
   const bounds=await page.evaluate(()=>({root:document.documentElement.scrollWidth,viewport:innerWidth,main:document.querySelector('#main-content')?.scrollWidth}));
   checks.push({route,width,...bounds});
   if(phase==='after') assert.ok(bounds.root<=width+1,`${route} overflows at ${width}`);
   if(phase==='after') {
    const clippedHeader=await page.locator('header').first().locator('button').evaluateAll(nodes=>nodes.filter(n=>{const r=n.getBoundingClientRect();return r.width>0&&r.height>0&&(r.left<-.5||r.right>innerWidth+.5);}).map(n=>n.getAttribute('aria-label')||n.textContent));
    assert.deepEqual(clippedHeader,[],`${route}: header controls clipped at ${width}`);
   }
   if(phase==='after' && route!=='/repairs/board') {
    const clipped=await page.locator('#main-content .card').evaluateAll(nodes=>nodes.filter(n=>n.scrollWidth>n.clientWidth+2).map(n=>({text:n.innerText.slice(0,80),width:n.clientWidth,scroll:n.scrollWidth})));
    assert.deepEqual(clipped,[],`${route}: clipped card content at ${width}`);
   }
   if(phase==='after' && route==='/repairs/board' && width<640) check(`Overview stacks without horizontal navigation at ${width}`,await page.locator('[aria-label="ستون‌های تابلوی وضعیت"]').evaluate(el=>getComputedStyle(el).display==='grid'&&el.scrollWidth<=el.clientWidth+1));
  }
 }
 if(phase==='after') {
  await page.setViewportSize({width:1440,height:1000});
  const main=page.locator('#main-content');
  // Shared selector: real branch cookie, search, empty state, keyboard and light dismiss.
  await page.goto(BASE+'/devices',{waitUntil:'networkidle'});
  const branch=page.getByRole('combobox',{name:'انتخاب شعبه',exact:true});
  await branch.click();
  let popup=page.locator('.search-select-panel:popover-open');
  check('Integrated search receives focus',await popup.locator('input').evaluate(el=>el===document.activeElement));
  await popup.locator('input').fill('no-such-branch-123');
  check('Empty dropdown offers recovery',await popup.getByRole('status').isVisible());
  await popup.locator('input').fill('');
  await popup.locator('input').press('ArrowDown');await popup.locator('input').press('Enter');
  await page.waitForLoadState('networkidle');
  check('Keyboard selection closes dropdown',await page.locator('.search-select-panel:popover-open').count()===0);
  await branch.click();await page.locator('.search-select-panel:popover-open').getByRole('option',{name:'همه شعب',exact:true}).click();
  await page.waitForLoadState('networkidle');
  await branch.click();await page.keyboard.press('Escape');
  check('Escape restores selector focus',await branch.evaluate(el=>el===document.activeElement));
  // GET form semantics and filter preservation on devices.
  await page.goto(BASE+'/devices?q=Test',{waitUntil:'networkidle'});
  await main.getByRole('navigation',{name:'نوع دستگاه'}).getByRole('link',{name:'موبایل',exact:true}).click();
  await page.waitForURL(url=>url.searchParams.get('q')==='Test'&&url.searchParams.get('type')==='mobile');
  check('Device type filter preserves search',new URL(page.url()).searchParams.get('q')==='Test'&&new URL(page.url()).searchParams.get('type')==='mobile');
  await main.locator('#devices-search').fill('Fixture');await main.getByRole('button',{name:'جستجو',exact:true}).click();
  await page.waitForURL(url=>url.searchParams.get('q')==='Fixture');
  await page.waitForLoadState('networkidle');
  check('Device search preserves selected type',new URL(page.url()).searchParams.get('type')==='mobile');
  // The branch selector test above intentionally selected all branches.
  // Scope this populated-technician scenario back to the seeded branch.
  await context.addCookies([{name:'repaid_branch',value:'1',url:BASE}]);
  // Assignment pagination resets with a new filter; selections never escape current results.
  await page.goto(BASE+'/repairs/assignment',{waitUntil:'networkidle'});
  const initial=await (await context.request.get(BASE+'/api/repairs/assignment')).json();
  const ticket=[...initial.awaiting,...initial.assigned][0];
  assert.ok(ticket);
  await main.getByRole('button',{name:'بعدی',exact:true}).click();
  await page.waitForURL(/page=2/);
  await main.locator('#assign-q').fill(ticket.number);
  await page.waitForResponse(r=>r.url().includes('/api/repairs/assignment?')&&new URL(r.url()).searchParams.get('q')===ticket.number);
  await page.waitForURL(url=>!url.searchParams.has('page')&&url.searchParams.get('q')===ticket.number);
  await main.locator('[aria-busy="false"]').first().waitFor();
  await main.locator(`a[href="/repairs/${ticket.id}"]`).first().waitFor();
  check('Search resets inbox to first page',!new URL(page.url()).searchParams.has('page'));
  await main.getByRole('checkbox',{name:`انتخاب دستگاه ${ticket.number}`,exact:true}).check();
  await main.getByRole('button',{name:'ارجاع به تعمیرکار',exact:true}).first().click();
  let dialog=page.getByRole('dialog');
  await dialog.locator('#assign-technician-search').fill('not-a-technician');
  await dialog.getByRole('status').waitFor({state:'visible'});
  check('Technician picker has useful empty state',await dialog.getByRole('status').isVisible());
  await dialog.locator('#assign-technician-search').fill('');
  const helper=dialog.getByRole('combobox',{name:'تعمیرکار دوم',exact:true});
  await helper.click();popup=page.locator('.search-select-panel:popover-open');
  await popup.locator('input').fill('بدون');await popup.getByRole('option',{name:'بدون تعمیرکار دوم',exact:true}).click();
  check('Searchable dropdown works inside modal',await dialog.isVisible()&&await dialog.locator('#assign-helper').inputValue()==='');
  await helper.click();await page.keyboard.press('Escape');
  check('Dropdown Escape keeps assignment dialog open',await dialog.isVisible());
  await dialog.getByRole('button',{name:'انصراف',exact:true}).click();
  await main.locator('#assign-q').fill('nothing-matches-9876');
  await page.waitForResponse(r=>r.url().includes('/api/repairs/assignment?')&&new URL(r.url()).searchParams.get('q')==='nothing-matches-9876');
  check('Changing filters clears stale batch selection',await main.getByRole('button',{name:'لغو انتخاب',exact:true}).count()===0);
  // Failed loads cannot leave actionable stale cards.
  await page.route('**/api/repairs/assignment?**',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'خطای آزمون بارگذاری کارتابل'})}));
  await main.locator('#assign-q').fill('failure-case');await main.getByText('خطای آزمون بارگذاری کارتابل').waitFor();
  check('Inbox failure hides stale assignment actions',await main.locator('.card a[href^="/repairs/"]').count()===0);
  await page.unroute('**/api/repairs/assignment?**');await main.getByRole('button',{name:'تلاش دوباره',exact:true}).click();
  await main.getByText('خطای آزمون بارگذاری کارتابل').waitFor({state:'hidden'});
  if(process.env.UI_REFINE_MUTATIONS==='1') {
   // Real board transition on the disposable fixture; failed response must not move a card.
   await page.goto(BASE+'/repairs/board?q=LOAD-0',{waitUntil:'networkidle'});
   let card=main.locator('article').filter({has:page.getByRole('link',{name:'LOAD-0',exact:true})});
   const repairId=Number((await card.getByRole('link',{name:'LOAD-0',exact:true}).getAttribute('href')).split('/').at(-1));
   // DOM option objects do not serialize; capture explicit fields.
   const target=await card.locator('select').evaluate(el=>{const o=Array.from(el.options).find(o=>o.value!==el.value);return o?{value:o.value,label:o.label}:null;});
   assert.ok(target);
   const beforeStatus=db.prepare('SELECT status_id FROM repair_tickets WHERE id=?').get(repairId).status_id;
   await card.getByRole('combobox').click();await page.locator('.search-select-panel:popover-open').getByRole('option',{name:target.label,exact:true}).click();
   dialog=page.getByRole('dialog',{name:'تأیید تغییر وضعیت',exact:true});await dialog.waitFor();
   check('Board selection requires explicit confirmation',db.prepare('SELECT status_id FROM repair_tickets WHERE id=?').get(repairId).status_id===beforeStatus);
   await page.route(`**/api/repairs/${repairId}/status`,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'خطای آزمون تغییر وضعیت'})}));
   await dialog.getByRole('button',{name:'ثبت تغییر وضعیت',exact:true}).click();await dialog.getByRole('alert').waitFor();
   check('Failed board mutation preserves stored status',db.prepare('SELECT status_id FROM repair_tickets WHERE id=?').get(repairId).status_id===beforeStatus);
   await page.unroute(`**/api/repairs/${repairId}/status`);
   const committed=page.waitForResponse(r=>r.url().endsWith(`/api/repairs/${repairId}/status`)&&r.request().method()==='POST');
   await dialog.getByRole('button',{name:'ثبت تغییر وضعیت',exact:true}).click();assert.equal((await committed).status(),200);
   await dialog.waitFor({state:'hidden'});await page.reload({waitUntil:'networkidle'});
   check('Board status persists after reload',String(db.prepare('SELECT status_id FROM repair_tickets WHERE id=?').get(repairId).status_id)===target.value);
   check('Board status records audit history',Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity='repair_ticket' AND entity_id=? AND action='status_change'").get(repairId).n)>0);
  }
  // Correct Persian weekday, cross-year dates and unsaved report protection.
  await page.goto(BASE+'/daily-report?jy=1405&jm=8',{waitUntil:'networkidle'});
  await main.locator('#dr-summary').fill('گزارش ذخیره‌نشده برای بررسی رابط');
  await main.getByRole('button',{name:'۱ آبان ۱۴۰۵',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'تغییرات گزارش ذخیره نشده است',exact:true});await dialog.waitFor();
  await dialog.getByRole('button',{name:'بازگشت به گزارش',exact:true}).click();
  check('Cancel day switch preserves draft',await main.locator('#dr-summary').inputValue()==='گزارش ذخیره‌نشده برای بررسی رابط');
  await main.getByRole('button',{name:'۱ آبان ۱۴۰۵',exact:true}).click();await page.getByRole('button',{name:'ادامه بدون ذخیره',exact:true}).click();
  await main.locator('#dr-summary').waitFor();
  check('Confirmed day switch clears previous draft',await main.locator('#dr-summary').inputValue()==='');
  check('Persian weekday matches Gregorian date',await main.getByText(/۱ آبان ۱۴۰۵.*جمعه/).count()>0);
  if(process.env.UI_REFINE_MUTATIONS==='1') {
   const summary='گزارش واقعی آزمون رابط پایان روز کاری';
   await main.locator('#dr-summary').fill(summary);
   let saved=page.waitForResponse(r=>r.url().endsWith('/api/daily-reports')&&r.request().method()==='POST');
   await main.getByRole('button',{name:'ذخیره پیش‌نویس',exact:true}).click();assert.equal((await saved).status(),200);
   await main.locator('span.chip').filter({hasText:'پیش‌نویس'}).waitFor();
   const report=()=>db.prepare("SELECT summary,status FROM daily_reports WHERE report_date='2026-10-23' AND user_id=(SELECT id FROM users WHERE email='owner@repaid.local')").get();
   check('Daily report draft persists against selected day',report()?.status==='draft'&&report()?.summary===summary);
   saved=page.waitForResponse(r=>r.url().endsWith('/api/daily-reports')&&r.request().method()==='POST');
   await main.getByRole('button',{name:'ثبت نهایی گزارش',exact:true}).click();assert.equal((await saved).status(),200);
   await main.locator('span.chip').filter({hasText:'ثبت‌شده'}).waitFor();
   check('Daily report submission persists confirmed state',report()?.status==='submitted'&&report()?.summary===summary);
  }
  await page.goto(BASE+'/daily-report?jy=1405&jm=11',{waitUntil:'networkidle'});
  const activityRequest=page.waitForResponse(r=>r.url().includes('/api/daily-reports?activity=2027-01-21'));
  await main.getByRole('button',{name:'۱ بهمن ۱۴۰۵',exact:true}).click();await activityRequest;
  check('Winter calendar crosses Gregorian year correctly',true);
  // The screenshot's exact tab container must have no vertical or decorative scrollbar.
  await page.goto(BASE+`/repairs/${ticket.id}`,{waitUntil:'networkidle'});
  const tabStyle=await main.locator('.tab-scroll').evaluate(el=>({y:getComputedStyle(el).overflowY,bar:getComputedStyle(el).scrollbarWidth,height:el.clientHeight,scroll:el.scrollHeight}));
  check('Repair tabs have no vertical scrollbar',tabStyle.y==='hidden'&&tabStyle.bar==='none'&&tabStyle.scroll<=tabStyle.height+1);
  await main.locator('.tab-scroll').screenshot({path:`${out}/repair-tabs.png`});
  // Dark-theme captures and localized selectors on each edited page.
  await page.evaluate(()=>{localStorage.setItem('repaid_theme','dark');document.documentElement.classList.add('dark');});
  for(const width of [375,1440]) {
   await page.setViewportSize({width,height:1000});
   for(const route of ['/repairs/assignment','/repairs/board','/devices','/daily-report']) {
    await page.goto(BASE+route,{waitUntil:'networkidle'});
    await page.screenshot({path:`${out}/dark${route.replaceAll('/','-')}-${width}.png`,fullPage:true});
    check(`Dark ${route} at ${width}`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1&&document.documentElement.classList.contains('dark')));
   }
  }
 }
 assert.deepEqual(finances(),originalFinances,'UI review must not change financial or stock records');
 fs.writeFileSync(`${out}/results.json`,JSON.stringify({checks,interactions,errors},null,2));
 assert.deepEqual(errors,[]);
 await browser.close();
 db.close();
 console.log(`${phase}: ${checks.length} light page/viewport captures; ${interactions.length} interaction/theme checks; no browser runtime errors.`);
})().catch(async e=>{console.error(e);await browser?.close();db.close();process.exitCode=1;});
