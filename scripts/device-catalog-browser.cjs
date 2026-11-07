'use strict';
const assert=require('node:assert/strict');

/** Shared real browser journey, used against disposable SQLite and PostgreSQL. */
async function deviceCatalogBrowserAcceptance({page,origin,customerId,check,includeReception=true}){
 const api=async(path,method='GET',data)=>page.context().request.fetch(origin+path,{method,headers:{Origin:origin,...(method==='POST'?{'Idempotency-Key':crypto.randomUUID()}:{})},...(data?{data}:{}),failOnStatusCode:false});
 const save=async()=>{const response=page.waitForResponse(r=>r.url()===origin+'/api/device-types'&&r.request().method()==='PUT');await page.getByRole('button',{name:'ذخیره انواع دستگاه',exact:true}).click();const result=await response;assert.equal(result.status(),200,await result.text());return result.json();};
 if(includeReception){await page.goto(origin+'/');const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tehran',hour:'2-digit',hourCycle:'h23'}).format(new Date())),expected=hour<5||hour>=20?'شب بخیر':hour<12?'صبح بخیر':hour<17?'بعدازظهر بخیر':'عصر بخیر';assert.equal(await page.getByTestId('tehran-greeting').innerText(),expected);check('actual dashboard greeting follows Tehran time');}
 await page.goto(origin+'/settings/device-types');
 await page.locator('#device-type-new').fill('دستگاه آزمایشی');await page.getByRole('button',{name:'+ افزودن نوع دستگاه',exact:true}).click();
 await page.getByRole('button',{name:'+ فیلد اختصاصی',exact:true}).click();
 const title=page.locator('input[id^="label-custom_"]');await title.fill('توان مصرفی');const field=(await title.getAttribute('id')).slice('label-'.length);
 const kind=page.locator('#kind-'+field);await kind.locator('..').getByRole('combobox').click();await page.getByRole('option',{name:'عدد',exact:true}).click();
 await title.locator('xpath=../../..').getByRole('checkbox',{name:'اجباری',exact:true}).check();
 const catalog=await save(),type=catalog.types.find(t=>t.label==='دستگاه آزمایشی');assert.ok(type);assert.ok(type.fields.some(f=>f.id===field&&f.kind==='number'&&f.required));
 for(const width of [375,1440])for(const dark of [false,true]){await page.setViewportSize({width,height:1000});await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),dark);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Catalog editor fits both themes and viewports');}
 await page.goto(origin+'/devices');assert.equal(await page.locator(`nav[aria-label="نوع دستگاه"] a[href="/devices?type=${type.id}"]`).count(),0,'Empty category is hidden');
 const denied=await api('/api/devices','POST',{customer_id:customerId,type:type.id,brand:'A',model:'B'});assert.equal(denied.status(),400,'Required custom field enforced server-side');
 await page.goto(origin+'/devices/new?customer_id='+customerId);await page.getByRole('button',{name:'دستگاه آزمایشی',exact:true}).click();await page.locator('#brand').fill('آزمون');await page.locator('#model').fill('سفارشی');
 assert.equal(await page.getByRole('button',{name:'ذخیره دستگاه',exact:true}).isEnabled(),false);
 await page.locator('#device-'+field).fill('35.5');const created=page.waitForResponse(r=>r.url()===origin+'/api/devices'&&r.request().method()==='POST');await page.getByRole('button',{name:'ذخیره دستگاه',exact:true}).click();const createdResponse=await created;assert.equal(createdResponse.status(),200,await createdResponse.text());const device=await createdResponse.json();
 await page.waitForURL(new RegExp('/devices/'+device.id+'$'));await page.getByText('توان مصرفی',{exact:true}).waitFor();assert.equal(await page.getByText('35.5',{exact:true}).count(),1);
 for(const width of [375,1440]){await page.setViewportSize({width,height:1000});await page.goto(origin+'/devices');await page.locator(`nav[aria-label="نوع دستگاه"] a[href="/devices?type=${type.id}"]`).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Device list fits viewport');}
 // The complete reception screen remains explicitly gated in the isolated PG
 // profile. Its absence is not treated as a successful browser test.
 if(includeReception){await page.goto(origin+'/repairs/new');await page.locator('#fn').fill('نام');await page.locator('#ln').fill('آزمون');await page.locator('#mob').fill('09129990080');await page.getByRole('button',{name:'بعدی ←',exact:true}).click();await page.getByRole('button',{name:'دستگاه آزمایشی',exact:true}).click();await page.locator('#brand').fill('A');await page.locator('#model').fill('B');assert.equal(await page.getByRole('button',{name:'بعدی ←',exact:true}).isEnabled(),false);await page.locator('#dv-'+field).fill('42');assert.equal(await page.getByRole('button',{name:'بعدی ←',exact:true}).isEnabled(),true);check('actual reception uses the configured category fields and required-value gate');}
 if(includeReception){for(const [path,prefix] of [['/repairs/quick','quick'],['/repairs/bulk','bulk-0']]){await page.goto(origin+path);await page.getByRole('combobox',{name:'نوع دستگاه',exact:true}).first().click();await page.getByRole('option',{name:'دستگاه آزمایشی',exact:true}).click();await page.locator('#'+prefix+'-'+field).waitFor();assert.equal(await page.locator('#'+prefix+'-'+field).getAttribute('required'),'');}check('quick and bulk intake render the same configured required fields');}
 await page.goto(origin+'/settings/device-types');await page.getByRole('button',{name:'دستگاه آزمایشی',exact:true}).click();
 await page.getByRole('checkbox',{name:'فعال برای ثبت دستگاه جدید',exact:true}).uncheck();await save();
 const retired=await api('/api/devices','POST',{customer_id:customerId,type:type.id,brand:'A',model:'B',custom_fields:{[field]:'35.5'}});assert.equal(retired.status(),400);
 await page.goto(origin+'/devices/new?customer_id='+customerId);await page.locator('button').filter({hasText:'موبایل'}).first().waitFor();assert.equal(await page.getByRole('button',{name:'دستگاه آزمایشی',exact:true}).count(),0);
 await page.goto(origin+'/devices/'+device.id);await page.getByText('توان مصرفی',{exact:true}).waitFor();assert.equal(await page.getByText('35.5',{exact:true}).count(),1);
 await page.goto(origin+'/devices');assert.equal(await page.locator(`nav[aria-label="نوع دستگاه"] a[href="/devices?type=${type.id}"]`).count(),1,'Retirement never hides existing registered devices');
 check('real owner catalog editor, required custom fields, persisted registration/profile, empty-filter reappearance, retirement/history and mobile layout');
}
module.exports={deviceCatalogBrowserAcceptance};
