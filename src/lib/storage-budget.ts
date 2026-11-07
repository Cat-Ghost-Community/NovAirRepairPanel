import fs from 'node:fs';import {HttpError} from './http-error';
/** Allocation preflight, not an assertion that other processes cannot consume disk afterward. */
export function requireStorageSpace(directory:string,bytes:bigint,setting='REPAID_BACKUP_MIN_FREE_BYTES'){
 const reserve=process.env[setting]??'5368709120';if(!/^\d{1,20}$/.test(reserve)||bytes<BigInt(0))throw new Error('Invalid private storage disk budget');
 const disk=fs.statfsSync(directory,{bigint:true});if(disk.bavail*disk.bsize<BigInt(reserve)+bytes)throw new HttpError(507,'فضای کافی برای ذخیرهٔ امن وجود ندارد. مدیر سامانه باید فضای دیسک یا مسیر کاری را بررسی کند.');
}
