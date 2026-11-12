const fs=require('node:fs');
const {chromium}=require('playwright-core');
const base=process.env.BASE_URL||'http://127.0.0.1:3001';
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const results=[];
  try {
    const context=await browser.newContext({viewport:{width:320,height:900},locale:'fa-IR'});
    const login=await context.request.post(base+'/api/auth/login',{headers:{origin:new URL(base).origin},data:{email:process.env.EMAIL||'owner@repaid.local',password:process.env.PASSWORD||'demo1234'}});
    if(!login.ok()) throw new Error(`Login: ${login.status()}`);
    const page=await context.newPage();
    await page.goto(base+'/',{waitUntil:'load'});
    await page.getByRole('heading',{level:1}).first().waitFor();
    const header=await page.locator('header').first().evaluate(element=>Array.from(element.querySelectorAll('button')).map(button=>{const rect=button.getBoundingClientRect();return {label:button.getAttribute('aria-label')||button.textContent?.trim().slice(0,40),left:rect.left,right:rect.right,width:rect.width,height:rect.height,visible:rect.width>0&&rect.height>0};}));
    results.push({check:'mobile header targets',pass:header.filter(button=>button.visible).every(button=>button.left>=0&&button.right<=321&&button.width>=32&&button.height>=32),buttons:header});
    fs.writeFileSync('.qa-work/browser-interactions.json',JSON.stringify(results,null,2)+'\n');
    await page.getByRole('button',{name:'باز کردن منو',exact:true}).click({timeout:5000});
    results.push({check:'mobile navigation opens',pass:await page.locator('aside').last().isVisible()});
    await page.keyboard.press('Tab');
    results.push({check:'drawer keeps keyboard focus inside',pass:await page.getByRole('dialog',{name:'منوی اصلی'}).evaluate(dialog=>dialog.contains(document.activeElement))});
    await page.keyboard.press('Escape');
    await page.getByRole('dialog',{name:'منوی اصلی'}).waitFor({state:'hidden'});
    results.push({check:'mobile drawer Escape and focus restoration',pass:await page.getByRole('button',{name:'باز کردن منو',exact:true}).evaluate(button=>button===document.activeElement)});
    await page.getByRole('button',{name:'باز کردن منو',exact:true}).click();
    await page.setViewportSize({width:1440,height:900});
    await page.getByRole('dialog',{name:'منوی اصلی'}).waitFor({state:'hidden'});
    await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='جستجو');
    results.push({check:'desktop resize releases the mobile modal',pass:await page.getByRole('button',{name:'جستجو',exact:true}).evaluate(button=>button===document.activeElement)});
    const before=await page.locator('html').evaluate(element=>element.classList.contains('dark'));
    await page.getByRole('button',{name:'حالت تاریک',exact:true}).click();
    const after=await page.locator('html').evaluate(element=>element.classList.contains('dark'));
    await page.reload({waitUntil:'load'});
    await page.waitForFunction(expected=>document.documentElement.classList.contains('dark')===expected,after);
    const persisted=await page.locator('html').evaluate(element=>element.classList.contains('dark'));
    results.push({check:'theme toggle and reload persistence',pass:before!==after&&persisted===after});
    if(process.env.BROWSER_MUTATIONS==='1') {
      await page.goto(base+'/team',{waitUntil:'load'});
      await page.getByRole('button',{name:'+ افزودن کاربر',exact:true}).click();
      for(const width of [320,375,768,1440]) {
        await page.setViewportSize({width,height:900});
        const dialog=page.getByRole('dialog',{name:'افزودن کاربر جدید'});
        results.push({check:`user form fits ${width}px`,pass:await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth+1)});
      }
      await page.getByLabel('نام و نام خانوادگی *',{exact:true}).fill('آزمون مرورگری');
      await page.getByLabel('ایمیل (نام کاربری ورود) *',{exact:true}).fill(`browser-${Date.now()}@example.test`);
      await page.getByLabel('گذرواژه * (حداقل ۱۲ نویسه)',{exact:true}).fill('browser-fixture-password');
      await page.getByLabel('شعبه',{exact:true}).selectOption('1');
      const response=page.waitForResponse(response=>response.url()===base+'/api/users'&&response.request().method()==='POST');
      await page.getByRole('button',{name:'ثبت کاربر',exact:true}).click();
      const created=await response;
      results.push({check:'browser form creates a real staff record',pass:created.status()===201&&Boolean((await created.json()).id)});
      await page.getByRole('dialog',{name:'افزودن کاربر جدید'}).waitFor({state:'hidden'});
    }
    await page.goto(base+'/outbox',{waitUntil:'load'});
    await page.getByRole('heading',{level:1}).first().waitFor();
    await page.route('**/api/messages/dispatch*',route=>route.abort());
    await page.getByRole('button',{name:'همه',exact:true}).click();
    await page.reload({waitUntil:'load'});
    const failure=page.getByRole('alert').filter({hasText:'دریافت پیام‌ها ناموفق بود.'});
    await failure.waitFor();
    results.push({check:'outbox network failure is visible and retryable',pass:await page.getByRole('button',{name:'تلاش مجدد',exact:true}).isVisible()});
    await page.goto(base+'/missing-audit-page',{waitUntil:'load'});
    results.push({check:'missing page is Persian',pass:await page.getByRole('heading',{name:'صفحه در دسترس نیست',exact:true}).isVisible()});
    fs.writeFileSync('.qa-work/browser-interactions.json',JSON.stringify(results,null,2)+'\n');
    console.log(JSON.stringify(results));
    if(results.some(result=>!result.pass))process.exitCode=1;
  } finally {await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
