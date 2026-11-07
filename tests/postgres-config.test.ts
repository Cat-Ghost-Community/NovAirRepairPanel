import {describe,it} from 'node:test';import assert from 'node:assert/strict';import {createPostgresDatabase,safePostgresInteger} from '../src/lib/db/postgres';
import {assertSqliteRuntime} from '../src/lib/db/runtime';
describe('PostgreSQL configuration is explicit and exact',()=>{
 it('rejects TLS overrides, remote plaintext and unbounded pool settings before connecting',()=>{
  assert.throws(()=>createPostgresDatabase({connectionString:'postgres://u:p@db.example/test',allowLocalPlaintext:true}),/loopback/);
  assert.throws(()=>createPostgresDatabase({connectionString:'postgres://u:p@localhost/test?sslmode=disable',allowLocalPlaintext:true}),/overrides/);
  assert.throws(()=>createPostgresDatabase({connectionString:'postgres://u:p@localhost/test',maxConnections:0}),/pool size/);
  assert.throws(()=>createPostgresDatabase({connectionString:'file:///repaid.db'}),/PostgreSQL URL/);
 });
 it('does not coerce BIGINT or money into imprecise JavaScript numbers',()=>{assert.equal(safePostgresInteger('9007199254740991'),9007199254740991);assert.throws(()=>safePostgresInteger('9007199254740992'));assert.throws(()=>safePostgresInteger('0.5'));});
 it('blocks an unverified PostgreSQL live switch instead of silently falling back',()=>{assert.doesNotThrow(()=>assertSqliteRuntime('sqlite'));assert.throws(()=>assertSqliteRuntime('postgres'),/cutover is blocked/);assert.throws(()=>assertSqliteRuntime('unknown'),/Unsupported/);});
});
