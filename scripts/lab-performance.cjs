const fs=require('node:fs');
const {chromium}=require('playwright-core');
const base=process.env.BASE_URL||'http://127.0.0.1:3001';
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});const samples=[];
  try {
    for(const route of ['/login','/']) for(let run=1;run<=3;run++) {
      const context=await browser.newContext({viewport:{width:1440,height:900},locale:'fa-IR',reducedMotion:'reduce'});
      if(route==='/') {
        const login=await context.request.post(base+'/api/auth/login',{headers:{origin:new URL(base).origin},data:{email:process.env.EMAIL||'owner@repaid.local',password:process.env.PASSWORD||'demo1234'}});
        if(!login.ok()) throw new Error(`Login: ${login.status()}`);
      }
      const page=await context.newPage();
      await page.addInitScript(()=>{
        window.__auditMetrics={lcpMs:null,cls:0};
        new PerformanceObserver(list=>{for(const entry of list.getEntries()) window.__auditMetrics.lcpMs=entry.startTime;}).observe({type:'largest-contentful-paint',buffered:true});
        new PerformanceObserver(list=>{for(const entry of list.getEntries()) if(!entry.hadRecentInput) window.__auditMetrics.cls+=entry.value;}).observe({type:'layout-shift',buffered:true});
      });
      const response=await page.goto(base+route,{waitUntil:'load',timeout:30000});
      await page.getByRole('heading',{level:1}).first().waitFor();
      await page.evaluate(()=>document.fonts.ready);
      await page.waitForTimeout(1500);
      const metrics=await page.evaluate(()=>{
        const navigation=performance.getEntriesByType('navigation')[0];
        return {...window.__auditMetrics,ttfbMs:navigation.responseStart-navigation.requestStart,domContentLoadedMs:navigation.domContentLoadedEventEnd,fcpMs:performance.getEntriesByName('first-contentful-paint')[0]?.startTime,resourceCount:performance.getEntriesByType('resource').length,transferBytes:performance.getEntriesByType('resource').reduce((sum,entry)=>sum+entry.transferSize,0)};
      });
      samples.push({route,run,status:response.status(),...metrics});
      await context.close();
    }
    const report={base,timestamp:new Date().toISOString(),environment:'Local production build, desktop Chrome, 1440x900, no network/CPU throttling, fresh browser contexts, warm application server',samples,inp:'not measured; no real-user interaction population'};
    fs.writeFileSync('.qa-work/lab-performance.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
  } finally {await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
