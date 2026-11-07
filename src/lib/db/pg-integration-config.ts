/** Temporary isolated website acceptance boundary, never a live cutover switch.
 * Pure environment validation is safe in Next Proxy (no shared pool/global). */
export function postgresIntegration(environment:Readonly<Record<string,string|undefined>>=process.env){
 if(environment.REPAID_PG_INTEGRATION!=='1')return null;
 if(environment.REPAID_DATABASE_ENGINE!=='postgres')throw Error('PostgreSQL integration cannot fall back to SQLite');
 let url:URL,origin:URL;try{url=new URL(environment.REPAID_PG_URL??'');origin=new URL(environment.APP_ORIGIN??'');}catch{throw Error('Invalid isolated PostgreSQL integration configuration');}
 const schema=environment.REPAID_PG_SCHEMA??'',match=/^repaid_integration_([a-f0-9]{24})$/.exec(schema);
 if(!match||url.pathname!=='/repaid_phase01_'+match[1]||!['postgres:','postgresql:'].includes(url.protocol)||url.search||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!['127.0.0.1','localhost','[::1]'].includes(origin.hostname)||!['http:','https:'].includes(origin.protocol)||origin.pathname!=='/'||origin.username||origin.password||origin.search||origin.hash)throw Error('Isolated loopback PostgreSQL database, matching integration schema and origin required');
 return {connectionString:url.toString(),schema};
}
export function postgresIntegrationRoute(path:string,method='GET'){
 if(/^\/fonts\/vazirmatn\/33\.003\/(Vazirmatn-(Regular|Bold)\.woff2|OFL\.txt)$/.test(path))return ['GET','HEAD'].includes(method);
 if(path.startsWith('/_next/')||/^\/(favicon|icon)/.test(path))return ['GET','HEAD'].includes(method);
 if(path==='/login'||path==='/api/auth/login'||path==='/api/auth/logout'||path==='/api/auth/change-password'||path==='/api/customers')return ['GET','HEAD','POST'].includes(method);
 if(['/api/accounting','/api/bank','/api/expenses','/api/checks','/api/invoices','/api/payments','/api/installments','/api/purchase-orders','/api/customer-credit'].includes(path))return ['GET','HEAD','POST'].includes(method);
 if(/^\/api\/purchase-orders\/[1-9][0-9]*$/.test(path))return method==='POST';
 if(/^\/api\/purchase-orders\/[1-9][0-9]*\/preview$/.test(path))return ['GET','HEAD'].includes(method);
 if(path==='/api/payments/refund'||/^\/api\/invoices\/[1-9][0-9]*\/(?:confirm|cancel|payments)$/.test(path))return method==='POST';
 if(['/api/devices','/api/suppliers'].includes(path))return ['GET','HEAD','POST'].includes(method);
 if(path==='/api/notifications')return ['GET','HEAD','POST'].includes(method);
 if(path==='/api/branches')return ['GET','HEAD','POST','PATCH'].includes(method);
 if(['/appointments','/complaints'].includes(path))return ['GET','HEAD'].includes(method);
 if(['/api/appointments','/api/complaints'].includes(path))return ['GET','HEAD','POST'].includes(method);
 if(/^\/api\/(?:appointments|complaints)\/[1-9][0-9]*$/.test(path))return method==='PATCH';
 if(/^\/api\/appointments\/[1-9][0-9]*\/convert$/.test(path))return method==='POST';
 if(/^\/api\/repairs\/[1-9][0-9]*\/(diagnosis|checklist|status|qc|start)$/.test(path))return method==='POST';
 if(/^\/api\/repairs\/[1-9][0-9]*\/time$/.test(path))return ['GET','HEAD','POST'].includes(method);
 if(path==='/api/repairs')return ['GET','HEAD','POST'].includes(method);
 if(['/api/repairs/workflow','/api/repairs/assignment','/api/repairs/queue','/api/repairs/available','/api/repairs/technicians'].includes(path))return ['GET','HEAD'].includes(method);
 if(['/api/repairs/assign','/api/repairs/claim'].includes(path))return method==='POST';
 if(path==='/api/settings/repair-workflow'||/^\/api\/repairs\/[1-9][0-9]*\/notes$/.test(path))return ['GET','HEAD','POST'].includes(method);
 if(['/repairs/assignment','/repairs/queue','/settings/repair-workflow'].includes(path))return ['GET','HEAD'].includes(method);
 if(path==='/repairs'||/^\/repairs\/[1-9][0-9]*$/.test(path))return ['GET','HEAD'].includes(method);
 if(['/api/devices/check','/api/devices/service-reminders'].includes(path))return ['GET','HEAD','POST'].includes(method);
 if(path==='/api/devices/blacklist')return ['GET','HEAD','DELETE'].includes(method);
 if(path==='/chat')return ['GET','HEAD'].includes(method);
 if(['/api/chat/conversations','/api/chat/users','/api/chat/events','/api/chat/search','/api/chat/summary'].includes(path))return ['GET','HEAD'].includes(method)||(path==='/api/chat/conversations'&&method==='POST');
 if(/^\/api\/chat\/conversations\/[1-9][0-9]*(?:\/messages)?$/.test(path))return ['GET','HEAD','POST'].includes(method);
 if(/^\/api\/chat\/messages\/[1-9][0-9]*$/.test(path))return ['GET','HEAD','POST'].includes(method);
 if(path==='/api/chat/upload')return method==='POST';
 if(/^\/api\/chat\/attachments\/[1-9][0-9]*$/.test(path))return ['GET','HEAD'].includes(method);
 if(/^\/api\/customers\/[1-9][0-9]*$/.test(path))return ['GET','HEAD','POST'].includes(method);
 if(path==='/devices'||path==='/devices/new'||/^\/devices\/[1-9][0-9]*$/.test(path))return ['GET','HEAD'].includes(method);
 if(/^\/api\/invoices\/[1-9][0-9]*$/.test(path))return ['GET','HEAD'].includes(method);
 return ['GET','HEAD'].includes(method)&&(path==='/'||path==='/customers'||path==='/customers/new'||path==='/api/health'||/^\/(?:api\/)?customers\/[1-9][0-9]*$/.test(path));
}
