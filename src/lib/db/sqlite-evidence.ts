import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
const quote=(value:string)=>'"'+value.replaceAll('"','""')+'"';
export function sqliteProjectionHash(db:DatabaseSync,table:string,fields:string[],maxId?:bigint|null){
 const statement=db.prepare(`SELECT ${fields.map(quote).join(',')} FROM ${quote(table)}${maxId===undefined?'':' WHERE id<=?'} ORDER BY rowid`);statement.setReadBigInts(true);const hash=createHash('sha256');let rows=0;
 for(const row of statement.iterate(...(maxId===undefined?[]:[maxId]))){for(const field of fields){const value=row[field];let body:Buffer;
   if(value===null)body=Buffer.from('null');else if(typeof value==='bigint')body=Buffer.from('integer:'+value);else if(typeof value==='number'){body=Buffer.alloc(13);body.write('real:');body.writeDoubleBE(value,5);}else if(typeof value==='string')body=Buffer.concat([Buffer.from('text:'),Buffer.from(value)]);else if(value instanceof Uint8Array)body=Buffer.concat([Buffer.from('blob:'),value]);else throw new Error('Unsupported source projection type');
   const length=Buffer.alloc(8);length.writeBigUInt64BE(BigInt(body.byteLength));hash.update(length).update(body);
  }rows++;hash.update('\n');}
 return {rows,sha256:hash.digest('hex')};
}
