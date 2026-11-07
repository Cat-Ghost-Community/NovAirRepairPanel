import {createHash} from 'node:crypto';
import {postgresOperationalProfileStatements} from './pg-operational-profiles';
import {postgresRelation} from './postgres-auth';
import type {PostgresDatabase} from './postgres';

/** Version 10 replaces only the fixed enumeration. Version 5 stays immutable. */
export function postgresDeviceCatalogGuardStatement(schema:string){
 const t=(name:string)=>postgresRelation(schema,name),original=postgresOperationalProfileStatements(schema)[0];
 const fixed="IF NEW.type NOT IN ('mobile','laptop','desktop','tablet','console','smartwatch','printer','network','other') OR (NEW.battery_health IS NOT NULL AND NEW.battery_health NOT BETWEEN 0 AND 100) THEN RAISE EXCEPTION 'Invalid device attributes' USING ERRCODE='23514'; END IF;";
 const configured=`IF TG_OP='INSERT' OR NEW.type IS DISTINCT FROM OLD.type THEN
      IF EXISTS(SELECT 1 FROM ${t('settings')} WHERE key='devices.catalog.v1') THEN
       IF NOT EXISTS(SELECT 1 FROM ${t('settings')} s CROSS JOIN LATERAL jsonb_array_elements(s.value::jsonb->'types') definition WHERE s.key='devices.catalog.v1' AND definition->>'id'=NEW.type AND definition->'active'='true'::jsonb) THEN RAISE EXCEPTION 'Inactive or unknown device type' USING ERRCODE='23514'; END IF;
      ELSIF NEW.type NOT IN ('mobile','laptop','desktop','tablet','console','smartwatch','printer','network','other') THEN RAISE EXCEPTION 'Unknown device type' USING ERRCODE='23514'; END IF;
     END IF;
     IF NEW.battery_health IS NOT NULL AND NEW.battery_health NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'Invalid device attributes' USING ERRCODE='23514'; END IF;`;
 if(!original.includes(fixed))throw Error('Legacy operational guard requires explicit migration review');
 return original.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION').replace(fixed,configured);
}
export const postgresDeviceCatalogGuardChecksum=()=>createHash('sha256').update(postgresDeviceCatalogGuardStatement('repaid')).digest('hex');
export async function verifyPostgresDeviceCatalogGuard(db:PostgresDatabase,schema:string){
 const expected=postgresDeviceCatalogGuardStatement(schema).split('$guard$')[1],row=(await db.query(`SELECT p.prosrc,p.prosecdef,p.proconfig,l.lanname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname=$1 AND p.proname='pg_operational_profile_guard'`,[schema])).rows[0];
 if(!row||row.prosrc!==expected||row.prosecdef||row.lanname!=='plpgsql'||JSON.stringify(row.proconfig)!==JSON.stringify(['search_path=pg_catalog']))throw Error('Device catalog guard function missing or altered');
 const trigger=(await db.query(`SELECT t.tgtype,t.tgenabled,t.tgqual IS NOT NULL conditional,p.proname,nf.nspname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace nf ON nf.oid=p.pronamespace WHERE n.nspname=$1 AND c.relname='devices' AND t.tgname='pg_operational_profile_guard'`,[schema])).rows[0];
 if(!trigger||Number(trigger.tgtype)!==31||trigger.tgenabled!=='O'||trigger.conditional||trigger.proname!=='pg_operational_profile_guard'||trigger.nspname!==schema)throw Error('Device catalog source trigger missing or altered');return {verified:true as const};
}
