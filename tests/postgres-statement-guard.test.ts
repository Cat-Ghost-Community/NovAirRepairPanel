import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {assertPostgresStatement} from '../src/lib/db/postgres-sql';
describe('PostgreSQL transaction guard covers every SQL statement',()=>{
 it('rejects transaction/session commands hidden after ordinary statements',()=>{
  for(const command of ['COMMIT','ROLLBACK','BEGIN','START TRANSACTION','SAVEPOINT stolen','RELEASE SAVEPOINT stolen','END','ABORT','PREPARE TRANSACTION \'x\'','SET search_path=public','RESET ALL','DISCARD ALL']){
   assert.throws(()=>assertPostgresStatement('SELECT 1; /* outer /* nested */ done */ '+command));
  }
  assert.throws(()=>assertPostgresStatement("SELECT 'safe;COMMIT'; SELECT 2; COMMIT"));
 });
 it('accepts actual strings, quoted identifiers, comments and procedural bodies without rewriting SQL',()=>{
  for(const sql of ["SELECT ';COMMIT', 'it''s;BEGIN'",'SELECT "COMMIT;BEGIN"',"SELECT E'backslash\\\';COMMIT'",'SELECT $tag$;COMMIT;BEGIN$tag$',"CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM 1; END $$;",'SELECT 1; -- COMMIT\n SELECT 2;', '/* a /* COMMIT */ z */ SELECT 1', ';;; SELECT 1;;'])assert.doesNotThrow(()=>assertPostgresStatement(sql),sql);
 });
 it('rejects malformed quoting/comments instead of guessing where the next command starts',()=>{
  for(const sql of ["SELECT 'unterminated",'SELECT "unterminated','SELECT $tag$unterminated','SELECT 1; /* unfinished /* nested */'])assert.throws(()=>assertPostgresStatement(sql));
 });
 it('supports Persian dollar tags while still rejecting a subsequent transaction command',()=>{
  assert.doesNotThrow(()=>assertPostgresStatement('SELECT $آزمون$;COMMIT$آزمون$'));
  assert.throws(()=>assertPostgresStatement('SELECT $آزمون$;COMMIT$آزمون$; COMMIT'),/transaction boundary/);
 });
});
