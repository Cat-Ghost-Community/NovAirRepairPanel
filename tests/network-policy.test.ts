import {it} from 'node:test';
import assert from 'node:assert/strict';
import {NextRequest} from 'next/server';
import {proxy} from '../src/proxy';
import {approvedBrowserOrigins,browserContentSecurityPolicy,isPublicFont,DOMESTIC_SERVICE_HOSTS} from '../src/lib/network-policy';
import {assertOutboundUrl} from '../src/lib/outbound';
import {postgresIntegrationRoute} from '../src/lib/db/pg-integration-config';
it('keeps scripts/fonts first party, inline scripts nonced, domestic exceptions exact and styles compatible',()=>{
 const csp=browserContentSecurityPolicy('a'.repeat(32),{NODE_ENV:'production',REPAID_BROWSER_CONNECT_ORIGINS:'https://domestic.example.ir',REPAID_BROWSER_FORM_ORIGINS:'https://pay.example.ir'});
 assert.match(csp,/font-src 'self'/);assert.match(csp,/script-src-attr 'none'/);assert.match(csp,/nonce-aaaaaaaa/);assert.doesNotMatch(csp,/unsafe-eval/);assert.match(csp,/connect-src 'self' https:\/\/domestic.example.ir/);assert.match(csp,/form-action 'self' https:\/\/pay.example.ir/);
 for(const origin of ['https://example.ir/path','https://example.ir/','https://u:p@example.ir','http://example.ir','https://*.example.ir',"https://example.ir;script-src *",'https://example.ir\r\nX-Test: x'])assert.throws(()=>approvedBrowserOrigins(origin));
 assert.throws(()=>browserContentSecurityPolicy('<unsafe>',{}));
});
it('uses fresh nonces, overrides spoofed headers, and prevents sensitive HTML/API caching',()=>{
 const a=proxy(new NextRequest('http://localhost/login',{headers:{'x-nonce':'attacker'}})),b=proxy(new NextRequest('http://localhost/login'));
 assert.notEqual(a.headers.get('Content-Security-Policy'),b.headers.get('Content-Security-Policy'));assert.doesNotMatch(a.headers.get('Content-Security-Policy')??'',/attacker/);assert.equal(a.headers.get('Cache-Control'),'private, no-store');assert.match(a.headers.get('x-middleware-request-x-nonce')??'',/^[A-Za-z0-9+/=]+$/);
 const denied=proxy(new NextRequest('http://localhost/api/customers'));assert.equal(denied.status,401);assert.equal(denied.headers.get('X-Content-Type-Options'),'nosniff');
});
it('serves only reviewed print assets anonymously, including isolated PostgreSQL, preserving domestic server allowlists',()=>{
 for(const name of ['Vazirmatn-Regular.woff2','Vazirmatn-Bold.woff2','OFL.txt']){const path='/fonts/vazirmatn/33.003/'+name;assert.equal(isPublicFont(path),true);assert.equal(proxy(new NextRequest('http://localhost'+path)).status,200);assert.equal(postgresIntegrationRoute(path),true);assert.equal(postgresIntegrationRoute(path,'POST'),false);}
 assert.equal(isPublicFont('/fonts/unreviewed.js'),false);for(const host of DOMESTIC_SERVICE_HOSTS)assert.equal(assertOutboundUrl('https://'+host+'/').hostname,host);assert.throws(()=>assertOutboundUrl('https://cdn.jsdelivr.net/file'));
});
