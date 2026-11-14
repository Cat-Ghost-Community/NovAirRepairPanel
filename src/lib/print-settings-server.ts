import type {DatabaseSync} from 'node:sqlite';
import {parsePrintSettings,PRINT_SETTING_KEYS} from './print-settings';
import {getDb} from './db/schema';
import {postgresIntegration} from './db/pg-integration-config';
import {readyApplicationPostgres} from './db/pg-application';
import {postgresRelation} from './db/postgres-auth';

export function readPrintSettings(db:DatabaseSync){
  const rows=db.prepare(`SELECT key,value FROM settings WHERE key IN (${PRINT_SETTING_KEYS.map(()=>'?').join(',')})`).all(...PRINT_SETTING_KEYS);
  return parsePrintSettings(Object.fromEntries(rows.map(row=>[String(row.key),row.value])));
}
export async function currentPrintSettings(){
  if(!postgresIntegration())return readPrintSettings(getDb());
  const {database,schema}=await readyApplicationPostgres();
  const rows=(await database.query(`SELECT key,value FROM ${postgresRelation(schema,'settings')} WHERE key=ANY($1::text[])`,[PRINT_SETTING_KEYS])).rows;
  return parsePrintSettings(Object.fromEntries(rows.map(row=>[String(row.key),row.value])));
}
