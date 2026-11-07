'use strict';
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),crypto=require('node:crypto');
const domestic=new Set(['tracking.post.ir','api.kavenegar.com','rest.payamak-panel.com','api.ghasedak.me','gateway.ghasedak.me']);
const external=value=>/^(?:https?:)?\/\//i.test(value.trim());
function auditSource(file,source){
 const findings=[],violations=[],client=/^[\s\S]{0,150}["']use client["']/.test(source),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 const position=node=>ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1;
 function resource(value,node,kind){if(kind.endsWith('_srcSet')||kind.endsWith('_srcset')){for(const match of value.matchAll(/(?:^|,)\s*((?:https?:)?\/\/[^\s,]+)/gi))resource(match[1],node,'srcset_candidate');return;}if(!external(value))return;const item={file,line:position(node),kind,classification:'UNAPPROVED_RUNTIME',origin:origin(value)};findings.push(item);violations.push(item);}
 function origin(value){try{return new URL(value.startsWith('//')?'https:'+value:value).origin;}catch{return 'dynamic-or-invalid';}}
 function literal(node){if(!node)return null;if(ts.isStringLiteralLike(node))return node.text;if(ts.isTemplateExpression(node))return node.head.text;return null;}
 function guarded(node){if(ts.isCallExpression(node)&&node.expression.getText(ast)==='assertOutboundUrl')return true;if(!ts.isIdentifier(node))return false;let found=false;function visit(n){if(ts.isBinaryExpression(n)&&n.left.getText(ast)===node.text&&ts.isCallExpression(n.right)&&n.right.expression.getText(ast)==='assertOutboundUrl')found=true;if(ts.isVariableDeclaration(n)&&n.name.getText(ast)===node.text&&n.initializer&&ts.isCallExpression(n.initializer)&&n.initializer.expression.getText(ast)==='assertOutboundUrl')found=true;ts.forEachChild(n,visit);}visit(ast);return found;}
 function visit(node){
  if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node)){if(node.moduleSpecifier){const value=literal(node.moduleSpecifier);if(value)resource(value,node,'remote_module');}}
  if(ts.isJsxAttribute(node)&&node.initializer){const name=node.name.getText(ast),tag=node.parent.parent.tagName.getText(ast),value=ts.isStringLiteral(node.initializer)?node.initializer.text:ts.isJsxExpression(node.initializer)?literal(node.initializer.expression):null;if(value&&(name==='src'||name==='poster'||name==='srcSet'||name==='href'&&tag==='link'))resource(value,node,'browser_'+tag+'_'+name);}
  if(ts.isBinaryExpression(node)&&ts.isPropertyAccessExpression(node.left)&&['src','poster'].includes(node.left.name.text)){const value=literal(node.right);if(value)resource(value,node,'dynamic_resource_assignment');}
  if(ts.isCallExpression(node)){
   const callee=node.expression.getText(ast),value=literal(node.arguments[0]);
   if(['import','require'].includes(callee)&&value)resource(value,node,'remote_module');
   if(callee==='fetch'||['http.get','https.get','http.request','https.request','axios.get','axios.post'].includes(callee)){
    if(client){if(value)resource(value,node,'browser_transport');}
    else if(!value||external(value)){
     const approved=node.arguments[0]&&guarded(node.arguments[0]);const item={file,line:position(node),kind:'server_transport',classification:approved?'DOMESTIC_OR_DEPLOYMENT_APPROVED':'UNVERIFIED',destination:value?origin(value):'guarded dynamic URL'};findings.push(item);if(!approved)violations.push(item);
    }
   }
  }
  if(ts.isStringLiteralLike(node)||ts.isTemplateExpression(node)){
   const text=ts.isTemplateExpression(node)?node.getText(ast):node.text;
   for(const match of text.matchAll(/(?:url\(\s*["']?|@import\s*["'])((?:https?:)?\/\/[^\s"')]+)/gi))resource(match[1],node,'embedded_stylesheet_resource');
   for(const match of text.matchAll(/<(script|img|iframe|audio|video|source|link)\b[^>]*?\b(?:src|href|poster)\s*=\s*["']((?:https?:)?\/\/[^"']+)/gi))resource(match[2],node,'embedded_html_'+match[1]);
   for(const match of text.matchAll(/(?:https?|wss?):\/\/[^\s"'<>`}]+/g)){const host=origin(match[0]);findings.push({file,line:position(node),kind:'literal_reference_not_necessarily_request',origin:host,classification:[...domestic].some(x=>host==='https://'+x)?'DOMESTIC':host==='http://www.w3.org'?'NAMESPACE_NOT_REQUEST':'REFERENCE_REVIEW'});}
  }
  ts.forEachChild(node,visit);
 }visit(ast);
 if(/\.(css|scss|html|svg)$/.test(file))for(const match of source.matchAll(/(?:url\(\s*["']?|@import\s*["'])((?:https?:)?\/\/[^\s"')]+)/gi))resource(match[1],ast,'stylesheet_resource');
 if(/\.(html|svg)$/.test(file))for(const match of source.matchAll(/<(?:script|img|image|use|iframe|audio|video|source|link)\b[^>]*?\b(src|href|xlink:href|poster|srcset)\s*=\s*["']([^"']+)/gi))resource(match[2],ast,'static_'+match[1]);
 return {findings,violations};
}
function inventory(){const files=[];function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const name=path.join(dir,e.name);if(e.isDirectory())walk(name);else if(/\.(ts|tsx|js|jsx|css|scss|html|svg)$/.test(name))files.push(name.replaceAll('\\','/'));}}for(const root of ['src','public'])walk(root);
 const results=files.map(file=>auditSource(file,fs.readFileSync(file,'utf8'))),findings=results.flatMap(x=>x.findings),violations=results.flatMap(x=>x.violations),assets=JSON.parse(fs.readFileSync('docs/network-independence/assets.json','utf8'));
 for(const asset of assets.files){const filename='public/fonts/vazirmatn/33.003/'+asset.name,bytes=fs.readFileSync(filename);if(bytes.length!==asset.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==asset.sha256)violations.push({file:filename,kind:'asset_integrity'});if(asset.name.endsWith('.woff2')&&bytes.subarray(0,4).toString()!=='wOF2')violations.push({file:filename,kind:'invalid_font'});}
 return {files:files.length,findings,violations};
}
if(require.main===module){const result=inventory();if(process.argv.includes('--report')){fs.mkdirSync('docs/network-independence',{recursive:true});fs.writeFileSync('docs/network-independence/source-inventory.json',JSON.stringify(result,null,2)+'\n');}console.log(JSON.stringify({files:result.files,findings:result.findings.length,violations:result.violations}));if(result.violations.length)process.exitCode=1;}
module.exports={auditSource,inventory};
