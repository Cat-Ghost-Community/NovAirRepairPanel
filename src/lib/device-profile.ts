import {DEVICE_COLUMNS,deviceRegistrationSpecs,type DeviceCatalog} from './device-catalog';
import {HttpError} from './http-error';

export function deviceProfileChanges(catalog:DeviceCatalog,before:Record<string,unknown>,input:Record<string,unknown>){
 const allowed=new Set(['type','custom_fields','expected_updated_at',...Object.keys(DEVICE_COLUMNS)]);
 if(Object.keys(input).some(key=>!allowed.has(key)))throw new HttpError(400,'فیلد ویرایش دستگاه معتبر نیست؛ مالک و شعبه از این مسیر تغییر نمی‌کنند.');
 if(Object.hasOwn(input,'type')&&(typeof input.type!=='string'||!input.type.trim()))throw new HttpError(400,'نوع دستگاه معتبر نیست.');
 const type=typeof input.type==='string'?input.type:String(before.type),definition=catalog.types.find(row=>row.id===type);
 if(!definition||!definition.active&&type!==before.type)throw new HttpError(400,'نوع دستگاه معتبر نیست.');
 const changes:Record<string,string|number|null>={type};
 for(const field of Object.keys(DEVICE_COLUMNS))if(Object.hasOwn(input,field)){
  const value=input[field];
  if(value==null||value===''){changes[field]=null;continue;}
  if(field==='battery_health'){
   const number=Number(value);if(!/^\d{1,3}$/.test(String(value))||!Number.isSafeInteger(number)||number<0||number>100)throw new HttpError(400,'سلامت باتری باید بین صفر و صد باشد.');changes[field]=number;
  }else{
   if(typeof value!=='string'||value.length>(field==='notes'?4000:160)||value.includes('\0'))throw new HttpError(400,`${DEVICE_COLUMNS[field]} معتبر نیست.`);
   if(['purchase_date','warranty_until'].includes(field)&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))throw new HttpError(400,'تاریخ دستگاه معتبر نیست.');
   changes[field]=value.trim()||null;
  }
 }
 let oldSpecs:Record<string,string>;
 try{oldSpecs=typeof before.specs==='string'?JSON.parse(before.specs):{};}catch{throw new HttpError(409,'مشخصات قبلی دستگاه نیازمند بررسی است.');}
 if(!oldSpecs||Array.isArray(oldSpecs)||typeof oldSpecs!=='object')throw new HttpError(409,'مشخصات قبلی دستگاه معتبر نیست.');
 const editable=new Set(definition.fields.filter(field=>field.id.startsWith('custom_')).map(field=>field.id));
 const retained=Object.fromEntries(Object.entries(oldSpecs).filter(([key])=>!editable.has(key.split(':')[0])));
 const extra=Object.fromEntries(Object.entries(oldSpecs).filter(([key])=>!key.startsWith('custom_')));
 const validationCatalog={...catalog,types:catalog.types.map(row=>row.id===type?{...row,active:true}:row)};
 const specs=deviceRegistrationSpecs(validationCatalog,type,{...before,...changes,...input,specs:extra});
 changes.specs=JSON.stringify({...retained,...specs});
 return changes;
}
