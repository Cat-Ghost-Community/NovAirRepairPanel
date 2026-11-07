import {createHash} from 'node:crypto';
import {HttpError} from './http-error';

/** Historical canonicalization: keep byte-compatible with stored request hashes. */
function canonical(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value!==null&&typeof value==='object'){
    const object=value as Record<string,unknown>;
    return `{${Object.keys(object).sort().map(key=>`${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
  }
  if(value===undefined)return 'null';
  if(typeof value==='number'&&!Number.isFinite(value))throw new HttpError(400,'مقدار درخواست معتبر نیست.');
  return JSON.stringify(value);
}
export function operationHash(value:unknown):string{return createHash('sha256').update(canonical(value)).digest('hex');}
export function operationKey(value:unknown):string {
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(value))throw new HttpError(400,'شناسهٔ ضدتکرار معتبر برای این عملیات الزامی است.');
  return value;
}
