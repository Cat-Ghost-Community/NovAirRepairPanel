import type {DatabaseSync} from 'node:sqlite';
import {DEVICE_COLUMNS,deviceRegistrationSpecs} from './device-catalog';
import {readDeviceCatalog} from './device-catalog-store';
/** Caller owns the transaction, customer authorization, audit and workflow. */
export function insertRegisteredDevice(db:DatabaseSync,customerId:number,type:string,body:Record<string,unknown>,branch:number){
 const specs=deviceRegistrationSpecs(readDeviceCatalog(db),type,body),columns=['customer_id','type',...Object.keys(DEVICE_COLUMNS),'specs','branch_id'];
 const values=[customerId,type,...Object.keys(DEVICE_COLUMNS).map(key=>body[key]??null),JSON.stringify(specs),branch];
 return Number(db.prepare(`INSERT INTO devices(${columns.map(key=>'"'+key+'"').join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...values as (string|number|null)[]).lastInsertRowid);
}
