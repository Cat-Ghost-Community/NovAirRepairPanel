import {createHash} from 'node:crypto';
import {postgresRelation} from './postgres-auth';
import type {PostgresDatabase} from './postgres';

/** Additive native note history: old nullable provenance is preserved, never inferred. */
export function postgresRepairNotesStatements(schema:string){const q=(name:string)=>postgresRelation(schema,name);return [
 `ALTER TABLE ${q('repair_notes')} ADD COLUMN branch_id bigint REFERENCES ${q('branches')}(id)`,
 `CREATE FUNCTION ${q('pg_repair_note_guard')}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $note$
 DECLARE actor bigint; source record;
 BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Original repair note history is immutable' USING ERRCODE='55000'; END IF;
  actor:=NULLIF(current_setting('repaid.repair_note_actor',true),'')::bigint;
  SELECT * INTO source FROM ${q('repair_tickets')} WHERE id=NEW.ticket_id FOR UPDATE;
  IF actor IS NULL OR NEW.user_id IS DISTINCT FROM actor OR source.id IS NULL OR NEW.branch_id IS DISTINCT FROM source.branch_id OR NEW.kind IS NULL OR NEW.kind NOT IN ('private','internal','public') OR NEW.body IS NULL OR length(btrim(NEW.body))=0 OR octet_length(NEW.body)>40000 OR length(NEW.body)>10000 OR NEW.created_at IS NULL OR NOT pg_input_is_valid(NEW.created_at,'timestamp with time zone') THEN RAISE EXCEPTION 'Invalid native repair note evidence' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM ${q('users')} u JOIN ${q('branches')} b ON b.id=source.branch_id AND b.is_active=1 WHERE u.id=actor AND u.is_active=1 AND (u.role IN ('owner','admin') OR u.branch_id=source.branch_id)) THEN RAISE EXCEPTION 'Repair note actor outside active branch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END $note$`,
 `CREATE FUNCTION ${q('pg_repair_note_audit')}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $note$
 BEGIN INSERT INTO ${q('audit_logs')}(user_id,action,entity,entity_id,"after",branch_id) VALUES(NEW.user_id,'create','repair_note',NEW.id,to_jsonb(NEW)::text,NEW.branch_id); RETURN NULL; END $note$`,
 `CREATE FUNCTION ${q('pg_repair_note_commit')}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $note$
 BEGIN
  IF NOT EXISTS(SELECT 1 FROM ${q('audit_logs')} a WHERE a.entity='repair_note' AND a.entity_id=NEW.id AND a.action='create' AND a.user_id=NEW.user_id AND a.branch_id=NEW.branch_id AND a."after"::jsonb=to_jsonb(NEW)) OR NOT EXISTS(SELECT 1 FROM ${q('operation_receipts')} o WHERE o.operation='repair.note.create' AND o.actor_id=NEW.user_id AND o.branch_id=NEW.branch_id AND o.result_json::jsonb->>'id'=NEW.id::text AND o.result_json::jsonb->>'ticket_id'=NEW.ticket_id::text) THEN RAISE EXCEPTION 'Repair note durable operation and audit proof required' USING ERRCODE='23514'; END IF;
  RETURN NULL;
 END $note$`,
 `DROP TRIGGER repaid_unported_write ON ${q('repair_notes')}`,
 `CREATE TRIGGER pg_repair_note_guard BEFORE INSERT OR UPDATE OR DELETE ON ${q('repair_notes')} FOR EACH ROW EXECUTE FUNCTION ${q('pg_repair_note_guard')}()`,
 `CREATE TRIGGER pg_repair_note_truncate BEFORE TRUNCATE ON ${q('repair_notes')} FOR EACH STATEMENT EXECUTE FUNCTION ${q('pg_repair_note_guard')}()`,
 `CREATE TRIGGER pg_repair_note_audit AFTER INSERT ON ${q('repair_notes')} FOR EACH ROW EXECUTE FUNCTION ${q('pg_repair_note_audit')}()`,
 `CREATE CONSTRAINT TRIGGER pg_repair_note_commit AFTER INSERT ON ${q('repair_notes')} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${q('pg_repair_note_commit')}()`,
 `CREATE INDEX pg_repair_note_ticket_feed ON ${q('repair_notes')}(ticket_id,created_at DESC,id DESC)`,
 ];}
export function postgresRepairNotesChecksum(){return createHash('sha256').update(postgresRepairNotesStatements('repaid').join('\n')).digest('hex');}
export async function verifyPostgresRepairNotesGuards(db:PostgresDatabase,schema:string){
 const statements=postgresRepairNotesStatements(schema),expectedFunctions=statements.filter(s=>s.startsWith('CREATE FUNCTION'));
 for(const statement of expectedFunctions){const name=/CREATE FUNCTION [^.]+\."([a-z_]+)"/.exec(statement)?.[1],body=statement.split('$note$')[1];if(!name||body==null)throw Error('Unknown repair note guard');const rows=(await db.query(`SELECT p.prosrc,p.prosecdef,p.provolatile,p.pronargs,p.prokind,p.prorettype::regtype::text return_type,p.proconfig,l.lanname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname=$1 AND p.proname=$2`,[schema,name])).rows,r=rows[0];if(rows.length!==1||r.prosrc!==body||r.prosecdef||r.provolatile!=='v'||r.pronargs!==0||r.prokind!=='f'||r.return_type!=='trigger'||r.lanname!=='plpgsql'||JSON.stringify(r.proconfig)!==JSON.stringify(['search_path=pg_catalog']))throw Error('Native repair note guard missing or altered: '+name);}
 const rows=(await db.query(`SELECT t.tgname,t.tgtype,t.tgenabled,t.tgnargs,t.tgqual IS NOT NULL conditional,t.tgdeferrable,t.tginitdeferred,p.proname,nf.nspname function_schema FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace nf ON nf.oid=p.pronamespace WHERE n.nspname=$1 AND c.relname='repair_notes' AND NOT t.tgisinternal`,[schema])).rows;
 for(const [name,mask,deferred,fn] of [['pg_repair_note_guard',31,false,'pg_repair_note_guard'],['pg_repair_note_truncate',34,false,'pg_repair_note_guard'],['pg_repair_note_audit',5,false,'pg_repair_note_audit'],['pg_repair_note_commit',5,true,'pg_repair_note_commit']] as const){const r=rows.find(row=>row.tgname===name);if(!r||r.tgtype!==mask||r.tgenabled!=='O'||r.tgnargs!==0||r.conditional||r.tgdeferrable!==deferred||r.tginitdeferred!==deferred||r.proname!==fn||r.function_schema!==schema)throw Error('Native repair note trigger missing or altered: '+name);}
 if(rows.some(r=>r.tgname==='repaid_unported_write'))throw Error('Native repair note write fence remained');
 const index=(await db.query(`SELECT i.indisvalid,pg_get_indexdef(c.oid) definition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_index i ON i.indexrelid=c.oid WHERE n.nspname=$1 AND c.relname='pg_repair_note_ticket_feed'`,[schema])).rows;if(index.length!==1||!index[0].indisvalid||!String(index[0].definition).endsWith('(ticket_id, created_at DESC, id DESC)'))throw Error('Native repair note feed index missing or altered');
 const column=(await db.query(`SELECT a.attnotnull,format_type(a.atttypid,a.atttypmod) type FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname='repair_notes' AND a.attname='branch_id' AND NOT a.attisdropped`,[schema])).rows;if(column.length!==1||column[0].type!=='bigint'||column[0].attnotnull)throw Error('Native repair note provenance column missing or altered');
 const foreignKeys=(await db.query(`SELECT c.convalidated,c.confupdtype,c.confdeltype,c.confmatchtype,c.condeferrable,c.condeferred,r.relname referenced_table,nr.nspname referenced_schema,ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,pos) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY pos) fields,ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(attnum,pos) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum ORDER BY pos) referenced_fields FROM pg_constraint c JOIN pg_class x ON x.oid=c.conrelid JOIN pg_namespace n ON n.oid=x.relnamespace JOIN pg_class r ON r.oid=c.confrelid JOIN pg_namespace nr ON nr.oid=r.relnamespace WHERE n.nspname=$1 AND x.relname='repair_notes' AND c.contype='f'`,[schema])).rows;if(!foreignKeys.some(r=>r.convalidated&&r.confupdtype==='a'&&r.confdeltype==='a'&&r.confmatchtype==='s'&&!r.condeferrable&&!r.condeferred&&r.referenced_schema===schema&&r.referenced_table==='branches'&&JSON.stringify(r.fields)==='["branch_id"]'&&JSON.stringify(r.referenced_fields)==='["id"]'))throw Error('Native repair note branch foreign key missing or altered');
 return {verified:true,checksum:postgresRepairNotesChecksum()};
}
