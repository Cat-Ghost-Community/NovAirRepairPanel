import {HttpError} from './http-error';

export const DEVICE_CATALOG_KEY='devices.catalog.v1';
export type DeviceField={id:string;label:string;kind:'text'|'number'|'date'|'select'|'checkbox';required:boolean;options?:string[]};
export type DeviceType={id:string;label:string;icon:string;active:boolean;fields:DeviceField[]};
export type DeviceCatalog={revision:number;types:DeviceType[]};
export const DEVICE_COLUMNS:Record<string,string>={brand:'برند',model:'مدل',model_number:'شماره مدل',sku:'کد کالا',serial:'شماره سریال',imei:'IMEI',imei2:'IMEI دوم',mac:'آدرس MAC',asset_tag:'کد اموال',color:'رنگ',ram:'حافظه رم',storage:'حافظه',cpu:'پردازنده',gpu:'گرافیک',os:'سیستم‌عامل',os_version:'نسخه سیستم‌عامل',carrier:'اپراتور',battery_health:'سلامت باتری (٪)',condition:'وضعیت',purchase_date:'تاریخ خرید',warranty_until:'پایان ضمانت',notes:'توضیحات'};
const originals=[['mobile','موبایل','phone','imei storage carrier color battery_health'],['laptop','لپ‌تاپ','laptop','serial cpu ram storage gpu os'],['desktop','دسکتاپ','monitor','serial cpu ram gpu storage'],['tablet','تبلت','tablet','imei serial storage'],['console','کنسول بازی','gamepad','serial storage'],['smartwatch','ساعت هوشمند','watch','serial'],['printer','پرینتر','printer','serial'],['network','تجهیزات شبکه','router','mac serial'],['other','سایر','plug','serial']];
export function defaultDeviceCatalog():DeviceCatalog{return {revision:0,types:originals.map(([id,label,icon,fields])=>({id,label,icon,active:true,fields:['brand','model',...fields.split(' ')].map(key=>({id:key,label:DEVICE_COLUMNS[key],kind:key==='battery_health'?'number':'text',required:['brand','model'].includes(key)}))}))};}
export function deviceTypeLabel(catalog:DeviceCatalog,type:string){return catalog.types.find(t=>t.id===type)?.label??originals.find(t=>t[0]===type)?.[1]??type;}
export function deviceTypeIcon(catalog:DeviceCatalog,type:string){return catalog.types.find(t=>t.id===type)?.icon??originals.find(t=>t[0]===type)?.[2]??'plug';}
export function parseDeviceCatalog(value:string|undefined|null):DeviceCatalog{
 if(value===undefined)return defaultDeviceCatalog();
 if(typeof value!=='string')throw new HttpError(503,'پیکربندی انواع دستگاه نیازمند بررسی مدیر است؛ داده‌ای تغییر نکرد.');
 try{return validateDeviceCatalog(JSON.parse(value));}catch{throw new HttpError(503,'پیکربندی انواع دستگاه نیازمند بررسی مدیر است؛ داده‌ای تغییر نکرد.');}
}
export function validateDeviceCatalog(value:unknown):DeviceCatalog{
 const fail=()=>{throw new HttpError(400,'ساختار انواع دستگاه معتبر نیست؛ نام، شناسه، نوع فیلد و گزینه‌ها را بررسی کنید.');};
 if(!value||typeof value!=='object'||Array.isArray(value))return fail();
 const data=value as DeviceCatalog;
 if(!Number.isSafeInteger(data.revision)||data.revision<0||data.revision>=Number.MAX_SAFE_INTEGER||!Array.isArray(data.types)||!data.types.length||data.types.length>64||JSON.stringify(data).length>131072)return fail();
 const seen=new Set<string>();
 const text=(v:unknown,max:number)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
 const types=data.types.map(type=>{
  if(!type||!text(type.label,80)||typeof type.id!=='string'||!/^[a-z][a-z0-9_]{0,39}$/.test(type.id)||seen.has(type.id)||typeof type.active!=='boolean'||typeof type.icon!=='string'||!['phone','laptop','monitor','tablet','gamepad','watch','printer','router','plug'].includes(type.icon)||!Array.isArray(type.fields)||type.fields.length>32)return fail();
  seen.add(type.id);const keys=new Set<string>();
  const fields=type.fields.map(field=>{
   if(!field||typeof field.id!=='string'||(!Object.hasOwn(DEVICE_COLUMNS,field.id)&&!/^custom_[a-z0-9_]{1,25}$/.test(field.id))||keys.has(field.id)||!text(field.label,60)||!['text','number','date','select','checkbox'].includes(field.kind)||typeof field.required!=='boolean')return fail();
   if(field.id==='battery_health'&&field.kind!=='number'||['purchase_date','warranty_until'].includes(field.id)&&field.kind!=='date')return fail();
   keys.add(field.id);let options:string[]|undefined;
   if(field.kind==='select'){if(!Array.isArray(field.options)||!field.options.length||field.options.length>40||field.options.some(o=>!text(o,80))||new Set(field.options.map(o=>o.trim())).size!==field.options.length)return fail();options=field.options.map(o=>o.trim());}
   return {id:field.id,label:field.label.trim(),kind:field.kind,required:field.required,...(options?{options}:{})};
  });
  return {id:type.id,label:type.label.trim(),icon:type.icon,active:type.active,fields};
 });
 if(!types.some(type=>type.active))return fail();return {revision:data.revision,types};
}
export function reviseDeviceCatalog(current:DeviceCatalog,payload:unknown):DeviceCatalog{
 const proposed=validateDeviceCatalog(payload);
 if(proposed.revision!==current.revision)throw new HttpError(409,'تنظیمات توسط کاربر دیگری تغییر کرده است؛ صفحه را تازه کنید.');
 // Omission retires a type. Its original identity and label remain readable.
 for(const old of current.types)if(!proposed.types.some(t=>t.id===old.id))proposed.types.push({...old,active:false});
 const next={...proposed,revision:current.revision+1};return validateDeviceCatalog(next);
}
export function validateDeviceRegistration(catalog:DeviceCatalog,typeId:string,body:Record<string,unknown>){
 const type=catalog.types.find(t=>t.id===typeId&&t.active);
 if(!type)throw new HttpError(400,'این نوع دستگاه برای ثبت جدید فعال نیست؛ فرم را تازه کنید.');
 for(const [id,label] of Object.entries(DEVICE_COLUMNS)){
  const value=body[id];if(value==null||value==='')continue;
  if(id==='battery_health'){if(!/^\d{1,3}$/.test(String(value))||Number(value)>100)throw new HttpError(400,'سلامت باتری باید بین صفر و صد باشد.');}
  else if(typeof value!=='string'||value.length>(id==='notes'?4000:160)||value.includes('\0'))throw new HttpError(400,`${label} معتبر نیست.`);
 }
 const custom:Record<string,string>={};
 const supplied=body.custom_fields??{};
 if(!supplied||typeof supplied!=='object'||Array.isArray(supplied))throw new HttpError(400,'مشخصات سفارشی دستگاه معتبر نیست.');
 const allowed=new Set(type.fields.filter(f=>f.id.startsWith('custom_')).map(f=>f.id));
 if(Object.keys(supplied).some(key=>!allowed.has(key)))throw new HttpError(400,'فیلد سفارشی به این نوع دستگاه تعلق ندارد.');
 for(const field of type.fields){
  const raw=field.id.startsWith('custom_')?(supplied as Record<string,unknown>)[field.id]:body[field.id];
  const empty=raw==null||typeof raw==='string'&&!raw.trim();
  if(empty){if(field.required)throw new HttpError(400,`${field.label} الزامی است.`);continue;}
  if(!['string','number','boolean'].includes(typeof raw))throw new HttpError(400,`${field.label} معتبر نیست.`);
  const value=String(raw).trim(),limit=field.id==='notes'?4000:field.id.startsWith('custom_')?1000:160;
  if(value.length>limit||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw new HttpError(400,`${field.label} بیش از حد طولانی یا نامعتبر است.`);
  if(field.kind==='number'&&(!/^-?\d{1,12}(?:\.\d{1,6})?$/.test(value)||!Number.isFinite(Number(value))))throw new HttpError(400,`${field.label} باید عدد باشد.`);
  if(field.id==='battery_health'&&(!/^\d+$/.test(value)||Number(value)>100))throw new HttpError(400,'سلامت باتری باید بین صفر و صد باشد.');
  if(field.kind==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))throw new HttpError(400,`${field.label} تاریخ معتبر نیست.`);
  if(field.kind==='select'&&!field.options?.includes(value))throw new HttpError(400,`${field.label} را از گزینه‌های مجاز انتخاب کنید.`);
  if(field.kind==='checkbox'&&!['true','false','1','0'].includes(value))throw new HttpError(400,`${field.label} معتبر نیست.`);
  if(field.kind==='checkbox'&&field.required&&!['true','1'].includes(value))throw new HttpError(400,`${field.label} باید تأیید شود.`);
  if(field.id.startsWith('custom_'))custom[field.id+':'+field.label]=value;
 }
 return custom;
}
export function deviceFormComplete(catalog:DeviceCatalog,type:string,body:Record<string,unknown>){try{validateDeviceRegistration(catalog,type,body);return true;}catch{return false;}}
export function deviceRegistrationSpecs(catalog:DeviceCatalog,type:string,body:Record<string,unknown>){
 const existing=body.specs??{};
 if(!existing||typeof existing!=='object'||Array.isArray(existing)||Object.entries(existing).some(([k,v])=>k.startsWith('custom_')||k.length>100||typeof v!=='string'||v.length>1000||v.includes('\0')))throw new HttpError(400,'مشخصات تکمیلی معتبر نیست.');
 const result={...existing,...validateDeviceRegistration(catalog,type,body)};if(Object.keys(result).length>50)throw new HttpError(400,'تعداد مشخصات تکمیلی بیش از حد مجاز است.');return result;
}
export function deviceFormPayload(catalog:DeviceCatalog,type:string,body:Record<string,unknown>):Record<string,unknown>&{type:string;custom_fields:Record<string,unknown>}{
 const fields=new Set(catalog.types.find(t=>t.id===type)?.fields.map(f=>f.id)??[]),values=Object.fromEntries(Object.entries(body).filter(([id])=>fields.has(id)));
 return {...values,type,custom_fields:Object.fromEntries(Object.entries(body.custom_fields??{}).filter(([id])=>fields.has(id))),...(fields.has('battery_health')?{battery_health:body.battery_health===''||body.battery_health==null?null:Number(body.battery_health)}:{})};
}
export function customDeviceSpecs(value:unknown){
 try{const data=typeof value==='string'?JSON.parse(value):value;if(!data||typeof data!=='object'||Array.isArray(data))return [];return Object.entries(data).filter(([key,v])=>key.startsWith('custom_')&&key.includes(':')&&typeof v==='string').map(([key,value])=>({label:key.slice(key.indexOf(':')+1),value:String(value)}));}catch{return [];}
}
