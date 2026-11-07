import {it} from 'node:test';
import assert from 'node:assert/strict';
import {NextRequest} from 'next/server';
import {postgresIntegration,postgresIntegrationRoute} from '../src/lib/db/pg-integration-config';
import {assertSqliteRuntime} from '../src/lib/db/runtime';
import {readRequestJson} from '../src/lib/request-json';
const suffix='a'.repeat(24),configuration={REPAID_DATABASE_ENGINE:'postgres',REPAID_PG_INTEGRATION:'1',REPAID_PG_URL:'postgresql://test:private@127.0.0.1/repaid_phase01_'+suffix,REPAID_PG_SCHEMA:'repaid_integration_'+suffix,APP_ORIGIN:'http://127.0.0.1:3044'};
it('keeps the global PostgreSQL runtime block even when an isolated website slice is configured',()=>{assert.equal(postgresIntegration({REPAID_DATABASE_ENGINE:'postgres'}),null);assert.ok(postgresIntegration(configuration));assert.throws(()=>assertSqliteRuntime('postgres',configuration),/blocked/);assert.throws(()=>postgresIntegration({...configuration,REPAID_DATABASE_ENGINE:'sqlite'}),/fall back/);});
it('rejects production/shared databases, remote hosts and mismatched namespaces in the integration gate',()=>{for(const changed of [{REPAID_PG_URL:'postgresql://test:private@127.0.0.1/production'},{REPAID_PG_URL:'postgresql://test:private@example.invalid/repaid_phase01_'+suffix},{REPAID_PG_SCHEMA:'repaid'},{REPAID_PG_SCHEMA:'repaid_integration_'+'b'.repeat(24)},{APP_ORIGIN:'https://customer.example.com'}])assert.throws(()=>postgresIntegration({...configuration,...changed}),/isolated|Isolated/);});
it('does not disclose credentials from invalid integration URL errors',()=>{const secret='not-a-valid-url-private-password';assert.throws(()=>postgresIntegration({...configuration,REPAID_PG_URL:secret}),error=>error instanceof Error&&!error.message.includes(secret));});
it('exposes native appointment/complaint workflows and repair intake/read without enabling unfinished financial mutations',()=>{
 for(const route of ['/appointments','/complaints','/repairs','/repairs/12','/api/appointments','/api/complaints','/api/repairs'])assert.equal(postgresIntegrationRoute(route),true,route);
 for(const route of ['/api/appointments','/api/complaints','/api/repairs','/api/appointments/12/convert'])assert.equal(postgresIntegrationRoute(route,'POST'),true,route);
 for(const route of ['/api/appointments/12','/api/complaints/12'])assert.equal(postgresIntegrationRoute(route,'PATCH'),true,route);
 for(const route of ['/api/repairs/12/parts','/api/repairs/12/settle','/api/repairs/12/cancel','/repairs/new'])assert.equal(postgresIntegrationRoute(route,'POST'),false,route);
});
it('admits controlled repair assignment and notes without exposing unfinished settings or financial operations',()=>{
 for(const route of ['/repairs/assignment','/repairs/queue','/settings/repair-workflow','/api/repairs/workflow','/api/repairs/assignment','/api/repairs/queue','/api/repairs/available','/api/repairs/technicians','/api/settings/repair-workflow','/api/repairs/12/notes'])assert.equal(postgresIntegrationRoute(route),true,route);
 for(const route of ['/api/repairs/assign','/api/repairs/claim','/api/settings/repair-workflow','/api/repairs/12/notes'])assert.equal(postgresIntegrationRoute(route,'POST'),true,route);
 for(const route of ['/settings','/api/settings','/api/repairs/transfers'])for(const method of ['GET','POST','PATCH','DELETE'])assert.equal(postgresIntegrationRoute(route,method),false,route+' '+method);
 for(const route of ['/api/repairs/assign','/api/repairs/claim'])assert.equal(postgresIntegrationRoute(route,'GET'),false,route);
 for(const route of ['/api/settings/repair-workflow','/api/repairs/12/notes'])for(const method of ['PATCH','DELETE'])assert.equal(postgresIntegrationRoute(route,method),false,route+' '+method);
});
it('admits native internal chat and device control handlers without widening unimplemented HTTP methods',()=>{
 for(const route of ['/chat','/api/chat/users','/api/chat/search','/api/chat/summary','/api/chat/events','/api/chat/conversations/4/messages','/api/chat/messages/4','/api/chat/attachments/4','/api/devices/check','/api/devices/blacklist','/api/devices/service-reminders'])assert.equal(postgresIntegrationRoute(route),true,route);
 for(const route of ['/api/chat/conversations','/api/chat/conversations/4','/api/chat/conversations/4/messages','/api/chat/messages/4','/api/chat/upload','/api/devices/check','/api/devices/service-reminders'])assert.equal(postgresIntegrationRoute(route,'POST'),true,route);
 assert.equal(postgresIntegrationRoute('/api/devices/blacklist','DELETE'),true);
 for(const [route,method]of [['/api/chat/messages/4','DELETE'],['/api/chat/attachments/4','POST'],['/api/devices/blacklist','POST'],['/chat','POST'],['/api/chat/conversations/0','POST'],['/api/chat/customer','POST']])assert.equal(postgresIntegrationRoute(route,method),false,route);
});
it('only admits implemented routes and mutation methods instead of executing SQLite compatibility paths',()=>{for(const route of ['/customers','/customers/new','/customers/15','/api/customers/15','/api/health','/api/accounting','/api/invoices'])assert.equal(postgresIntegrationRoute(route),true);for(const route of ['/api/customers','/api/customers/15','/api/devices','/api/suppliers','/api/notifications','/api/branches','/api/invoices','/api/payments','/api/expenses','/api/checks','/api/bank','/api/installments','/api/customer-credit','/api/invoices/15/confirm','/api/purchase-orders','/api/purchase-orders/15'])assert.equal(postgresIntegrationRoute(route,'POST'),true);for(const route of ['/api/invoices/15','/api/customers/import','/api/customers/merge','/api/returns','/api/payroll'])assert.equal(postgresIntegrationRoute(route,'POST'),false);assert.equal(postgresIntegrationRoute('/customers','POST'),false);});
it('parses same-origin bounded JSON without needing a database or session lookup',async()=>{const request=new NextRequest('http://127.0.0.1:3044/api/customers',{method:'POST',headers:{Origin:'http://127.0.0.1:3044','Content-Type':'application/json'},body:'{"first_name":"آزمون"}'});const previous=process.env.APP_ORIGIN;process.env.APP_ORIGIN='http://127.0.0.1:3044';try{assert.deepEqual(await readRequestJson(request),{first_name:'آزمون'});}finally{if(previous==null)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=previous;}});
it('retains CSRF, object-shape and actual-stream size enforcement',async()=>{const previous=process.env.APP_ORIGIN;process.env.APP_ORIGIN='http://127.0.0.1:3044';try{for(const [origin,body,status] of [['https://foreign.invalid','{}',403],['http://127.0.0.1:3044','[]',400],['http://127.0.0.1:3044','{"notes":"'+'a'.repeat(1024*1024)+'"}',413]] as const){const req=new NextRequest('http://127.0.0.1:3044/api/customers',{method:'POST',headers:{Origin:origin},body});await assert.rejects(()=>readRequestJson(req),error=>(error as {status:number}).status===status);}}finally{if(previous==null)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=previous;}});

it('admits only implemented technical work methods and retains financial, invalid-id and unsupported-method fences',()=>{
 for(const action of ['start','status','diagnosis','checklist','qc']){const route='/api/repairs/12/'+action;assert.equal(postgresIntegrationRoute(route,'POST'),true);for(const method of ['GET','HEAD','PATCH','DELETE'])assert.equal(postgresIntegrationRoute(route,method),false);}
 for(const method of ['GET','HEAD','POST'])assert.equal(postgresIntegrationRoute('/api/repairs/12/time',method),true);
 for(const route of ['/api/repairs/0/start','/api/repairs/12/items','/api/repairs/12/cancel','/api/repairs/12/deliver'])assert.equal(postgresIntegrationRoute(route,'POST'),false);
 for(const method of ['PATCH','DELETE'])assert.equal(postgresIntegrationRoute('/api/repairs/12/time',method),false);
});
