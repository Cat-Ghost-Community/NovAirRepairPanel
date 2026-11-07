'use strict';
// Test-process instrumentation, never imported by application code. No response stubs.
const net=require('node:net'),dns=require('node:dns'),fs=require('node:fs'),{syncBuiltinESMExports}=require('node:module');
if(process.env.REPAID_NETWORK_ISOLATION_TEST!=='1')throw Error('Explicit network-isolation test configuration required');
const allowed=new Set(['127.0.0.1','::1','localhost','[::1]']),audit=process.env.REPAID_NETWORK_AUDIT_FILE;
if(!audit||!require('node:path').isAbsolute(audit))throw Error('Explicit private network audit file required');
function record(host,permitted,transport){fs.appendFileSync(audit,JSON.stringify({host:String(host).slice(0,255),permitted,transport})+'\n',{mode:0o600});}
function denied(host){const error=new Error('Test process refused unapproved outbound network');error.code='REPAID_TEST_EGRESS_DENIED';record(host,false,'blocked');return error;}
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){let value=args[0];if(Array.isArray(value))value=value[0];
 if(value&&typeof value==='object'&&value.path&&!value.port)return connect.apply(this,args);
 if(typeof value==='string'&&!/^\d+$/.test(value)&&(/^[\\/]/.test(value)))return connect.apply(this,args);
 const host=value&&typeof value==='object'?(value.host??value.hostname??'localhost'):(typeof args[1]==='string'?args[1]:'localhost');
 if(!allowed.has(String(host).toLowerCase()))throw denied(host);record(host,true,'tcp');return connect.apply(this,args);
};
for(const method of ['lookup','resolve','resolve4','resolve6','resolveAny','resolveCname','resolveMx','resolveNs','resolvePtr','resolveSoa','resolveSrv','resolveTxt','reverse']){
 const original=dns[method];if(typeof original!=='function')continue;
 dns[method]=function(host,...args){if(allowed.has(String(host).toLowerCase()))return original.call(this,host,...args);const error=denied(host),callback=args.at(-1);if(typeof callback==='function'){queueMicrotask(()=>callback(error));return;}throw error;};
 if(typeof dns.promises[method]==='function'){const promise=dns.promises[method];dns.promises[method]=function(host,...args){return allowed.has(String(host).toLowerCase())?promise.call(this,host,...args):Promise.reject(denied(host));};}
}
syncBuiltinESMExports();
