/** Existing domestic adapters; deployment approval is separate from geographic reachability. */
export const DOMESTIC_SERVICE_HOSTS=['tracking.post.ir','api.kavenegar.com','rest.payamak-panel.com','api.ghasedak.me','gateway.ghasedak.me'] as const;
export const PRINT_FONT_ROOT='/fonts/vazirmatn/33.003';
export function isPublicFont(path:string){return /^\/fonts\/vazirmatn\/33\.003\/(Vazirmatn-(Regular|Bold)\.woff2|OFL\.txt)$/.test(path);}
type Environment=Readonly<Record<string,string|undefined>>;
export function approvedBrowserOrigins(value:string|undefined):string[]{
 const origins=[...new Set((value??'').split(',').map(x=>x.trim()).filter(Boolean))];
 if(origins.length>20)throw Error('Too many approved browser origins');
 return origins.map(origin=>{let url:URL;try{url=new URL(origin);}catch{throw Error('Invalid approved browser origin');}
  if(url.protocol!=='https:'||!url.hostname.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))||url.origin!==origin||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Approved browser origins must be exact HTTPS origins');return url.origin;});
}
export function browserContentSecurityPolicy(nonce:string,environment:Environment=process.env){
 if(!/^[A-Za-z0-9+/=_-]{16,128}$/.test(nonce))throw Error('Invalid application nonce');
 const connections=approvedBrowserOrigins(environment.REPAID_BROWSER_CONNECT_ORIGINS),forms=approvedBrowserOrigins(environment.REPAID_BROWSER_FORM_ORIGINS),development=environment.NODE_ENV==='development';
 return ["default-src 'self'",`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development?" 'unsafe-eval'":''}`,"script-src-attr 'none'","style-src 'self' 'unsafe-inline'","font-src 'self'","img-src 'self' data: blob:","media-src 'self' blob:",`connect-src 'self'${development?' ws:':''}${connections.length?' '+connections.join(' '):''}`,`form-action 'self'${forms.length?' '+forms.join(' '):''}`,"worker-src 'self' blob:","object-src 'none'","base-uri 'self'","frame-ancestors 'none'","frame-src 'none'"].join('; ');
}
