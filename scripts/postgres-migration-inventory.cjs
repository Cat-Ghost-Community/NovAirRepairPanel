#!/usr/bin/env node
'use strict';
// Static source inventory only: never imports application code, opens a database,
// reads environment secrets, or infers a passing test from a reference.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const ts=require('typescript');

const FORMAT_VERSION=1;
const API_METHODS=new Set(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']);
// Only add acceptance records after reviewing exact implementation/test evidence.
// Absence is meaningful: source presence is not completed migration acceptance.
const REVIEWED_ACCEPTANCE={
  "api_route:src/app/api/auth/login/route.ts": {
    "status": "isolated_pg_verified",
    "runtime_source_sha256": "0a129c1c0347cc15af40f9ab8edcfcd349080c1c53889ec7b1acd9c0c7254f7b",
    "verified_commit": "74e76ed140a6daebb090cd0874811298f9b4f665",
    "scope": "JSON credential login, failed/forged authentication and exact PostgreSQL session persistence",
    "verified_handlers": [
      "POST"
    ],
    "evidence": [
      {
        "url": "https://github.com/Cat-Ghost-Community/1beng/actions/runs/42119920640",
        "job": "postgres-acceptance",
        "native_tests_passed": 66,
        "http_browser_check_groups_passed": 13,
        "commands": [
          "npm run test:postgres",
          "PG_HTTP_BROWSER=1 npm run test:postgres:http"
        ]
      }
    ],
    "limits": [
      "Only the explicit loopback disposable integration database/schema and gated routes were accepted.",
      "No customer-data cutover, financial-module migration or customer-target deployment is certified."
    ]
  },
  "api_route:src/app/api/auth/logout/route.ts": {
    "status": "isolated_pg_verified",
    "runtime_source_sha256": "90987fec0b2022d2ef14aa8a6beb357a03598e3c8c4ff24ba465e9e27483461f",
    "verified_commit": "74e76ed140a6daebb090cd0874811298f9b4f665",
    "scope": "safe GET redirect; POST revokes the actual PostgreSQL session",
    "verified_handlers": [
      "GET",
      "POST"
    ],
    "evidence": [
      {
        "url": "https://github.com/Cat-Ghost-Community/1beng/actions/runs/42119920640",
        "job": "postgres-acceptance",
        "native_tests_passed": 66,
        "http_browser_check_groups_passed": 13,
        "commands": [
          "npm run test:postgres",
          "PG_HTTP_BROWSER=1 npm run test:postgres:http"
        ]
      }
    ],
    "limits": [
      "Only the explicit loopback disposable integration database/schema and gated routes were accepted.",
      "No customer-data cutover, financial-module migration or customer-target deployment is certified."
    ]
  },
  "api_route:src/app/api/auth/change-password/route.ts": {
    "status": "isolated_pg_verified",
    "runtime_source_sha256": "51688b0bbfe4dfed732336cb5fd307fd2390868a30f236b40bb9c208194ff446",
    "verified_commit": "74e76ed140a6daebb090cd0874811298f9b4f665",
    "scope": "password change, session rotation and revocation of old credentials",
    "verified_handlers": [
      "POST"
    ],
    "evidence": [
      {
        "url": "https://github.com/Cat-Ghost-Community/1beng/actions/runs/42119920640",
        "job": "postgres-acceptance",
        "native_tests_passed": 66,
        "http_browser_check_groups_passed": 13,
        "commands": [
          "npm run test:postgres",
          "PG_HTTP_BROWSER=1 npm run test:postgres:http"
        ]
      }
    ],
    "limits": [
      "Only the explicit loopback disposable integration database/schema and gated routes were accepted.",
      "No customer-data cutover, financial-module migration or customer-target deployment is certified."
    ]
  },
  "api_route:src/app/api/customers/route.ts": {
    "status": "isolated_pg_verified",
    "runtime_source_sha256": "2341e60b312e8d7d26b8b94cc7633f658a77b86db2f2aac655925b71e6020036",
    "verified_commit": "74e76ed140a6daebb090cd0874811298f9b4f665",
    "scope": "scoped list/search and audited create with durable replay, six-request concurrency and rollback",
    "verified_handlers": [
      "GET",
      "POST"
    ],
    "evidence": [
      {
        "url": "https://github.com/Cat-Ghost-Community/1beng/actions/runs/42119920640",
        "job": "postgres-acceptance",
        "native_tests_passed": 66,
        "http_browser_check_groups_passed": 13,
        "commands": [
          "npm run test:postgres",
          "PG_HTTP_BROWSER=1 npm run test:postgres:http"
        ]
      }
    ],
    "limits": [
      "Only the explicit loopback disposable integration database/schema and gated routes were accepted.",
      "No customer-data cutover, financial-module migration or customer-target deployment is certified."
    ]
  },
  "api_route:src/app/api/customers/[id]/route.ts": {
    "status": "isolated_pg_verified",
    "runtime_source_sha256": "e1eb92417909f15fbc9676d04c14fe936ecd06d2b86a60dbc02cd97c5455b557",
    "verified_commit": "74e76ed140a6daebb090cd0874811298f9b4f665",
    "scope": "scoped customer detail only; POST remains blocked/unverified",
    "verified_handlers": [
      "GET"
    ],
    "evidence": [
      {
        "url": "https://github.com/Cat-Ghost-Community/1beng/actions/runs/42119920640",
        "job": "postgres-acceptance",
        "native_tests_passed": 66,
        "http_browser_check_groups_passed": 13,
        "commands": [
          "npm run test:postgres",
          "PG_HTTP_BROWSER=1 npm run test:postgres:http"
        ]
      }
    ],
    "limits": [
      "Only the explicit loopback disposable integration database/schema and gated routes were accepted.",
      "No customer-data cutover, financial-module migration or customer-target deployment is certified."
    ]
  },
  "api_route:src/app/api/health/route.ts": {
    "status": "isolated_pg_verified",
    "runtime_source_sha256": "5c21bd3a7312004e137c678bdfb5282d61cc4313582d8da96a29203fdd055135",
    "verified_commit": "74e76ed140a6daebb090cd0874811298f9b4f665",
    "scope": "actual isolated PostgreSQL website health without SQLite files",
    "verified_handlers": [
      "GET"
    ],
    "evidence": [
      {
        "url": "https://github.com/Cat-Ghost-Community/1beng/actions/runs/42119920640",
        "job": "postgres-acceptance",
        "native_tests_passed": 66,
        "http_browser_check_groups_passed": 13,
        "commands": [
          "npm run test:postgres",
          "PG_HTTP_BROWSER=1 npm run test:postgres:http"
        ]
      }
    ],
    "limits": [
      "Only the explicit loopback disposable integration database/schema and gated routes were accepted.",
      "No customer-data cutover, financial-module migration or customer-target deployment is certified."
    ]
  },
  "layout:src/app/layout.tsx": {
    "status": "isolated_pg_verified",
    "runtime_source_sha256": "fe6cc004c31d85e3c84da4a8d0a223547a126982bde62593574a710c23744146",
    "verified_commit": "74e76ed140a6daebb090cd0874811298f9b4f665",
    "scope": "actual authenticated PostgreSQL SSR shell and branch scope, both themes",
    "evidence": [
      {
        "url": "https://github.com/Cat-Ghost-Community/1beng/actions/runs/42119920640",
        "job": "postgres-acceptance",
        "native_tests_passed": 66,
        "http_browser_check_groups_passed": 13,
        "commands": [
          "npm run test:postgres",
          "PG_HTTP_BROWSER=1 npm run test:postgres:http"
        ]
      }
    ],
    "limits": [
      "Only the explicit loopback disposable integration database/schema and gated routes were accepted.",
      "No customer-data cutover, financial-module migration or customer-target deployment is certified."
    ]
  },
  "page:src/app/login/page.tsx": {
    "status": "isolated_pg_verified",
    "runtime_source_sha256": "02690e1f544ff72d09ba86b5ce76ea4c453a7b92336cc39476588bf094dd5b31",
    "verified_commit": "74e76ed140a6daebb090cd0874811298f9b4f665",
    "scope": "rendered login form and session-aware navigation",
    "evidence": [
      {
        "url": "https://github.com/Cat-Ghost-Community/1beng/actions/runs/42119920640",
        "job": "postgres-acceptance",
        "native_tests_passed": 66,
        "http_browser_check_groups_passed": 13,
        "commands": [
          "npm run test:postgres",
          "PG_HTTP_BROWSER=1 npm run test:postgres:http"
        ]
      }
    ],
    "limits": [
      "Only the explicit loopback disposable integration database/schema and gated routes were accepted.",
      "No customer-data cutover, financial-module migration or customer-target deployment is certified."
    ]
  },
  "page:src/app/customers/page.tsx": {
    "status": "isolated_pg_verified",
    "runtime_source_sha256": "51e0440c77fe2d1372af9bafb52d06da3275bd972e1b9d1c67b595c563bff1b7",
    "verified_commit": "74e76ed140a6daebb090cd0874811298f9b4f665",
    "scope": "actual scoped PostgreSQL customer list, manager/staff visibility",
    "evidence": [
      {
        "url": "https://github.com/Cat-Ghost-Community/1beng/actions/runs/42119920640",
        "job": "postgres-acceptance",
        "native_tests_passed": 66,
        "http_browser_check_groups_passed": 13,
        "commands": [
          "npm run test:postgres",
          "PG_HTTP_BROWSER=1 npm run test:postgres:http"
        ]
      }
    ],
    "limits": [
      "Only the explicit loopback disposable integration database/schema and gated routes were accepted.",
      "No customer-data cutover, financial-module migration or customer-target deployment is certified."
    ]
  },
  "page:src/app/customers/new/page.tsx": {
    "status": "isolated_pg_verified",
    "runtime_source_sha256": "48b8d0d705aff45c72a2fb1ca9257a9bdded4cb679821f15e8d78c2b559573ca",
    "verified_commit": "74e76ed140a6daebb090cd0874811298f9b4f665",
    "scope": "actual customer creation form in desktop/mobile browser",
    "evidence": [
      {
        "url": "https://github.com/Cat-Ghost-Community/1beng/actions/runs/42119920640",
        "job": "postgres-acceptance",
        "native_tests_passed": 66,
        "http_browser_check_groups_passed": 13,
        "commands": [
          "npm run test:postgres",
          "PG_HTTP_BROWSER=1 npm run test:postgres:http"
        ]
      }
    ],
    "limits": [
      "Only the explicit loopback disposable integration database/schema and gated routes were accepted.",
      "No customer-data cutover, financial-module migration or customer-target deployment is certified."
    ]
  },
  "page:src/app/customers/[id]/page.tsx": {
    "status": "isolated_pg_verified",
    "runtime_source_sha256": "7cc448abb99f2abfe8465a9e9020b039bef051f01fa6b6d859b679fd92329faa",
    "verified_commit": "74e76ed140a6daebb090cd0874811298f9b4f665",
    "scope": "actual newly persisted customer profile; no certified financial balance",
    "evidence": [
      {
        "url": "https://github.com/Cat-Ghost-Community/1beng/actions/runs/42119920640",
        "job": "postgres-acceptance",
        "native_tests_passed": 66,
        "http_browser_check_groups_passed": 13,
        "commands": [
          "npm run test:postgres",
          "PG_HTTP_BROWSER=1 npm run test:postgres:http"
        ]
      }
    ],
    "limits": [
      "Only the explicit loopback disposable integration database/schema and gated routes were accepted.",
      "No customer-data cutover, financial-module migration or customer-target deployment is certified."
    ]
  },
  "server_action:src/app/login/page.tsx#login": {
    "status": "isolated_pg_verified",
    "runtime_source_sha256": "02690e1f544ff72d09ba86b5ce76ea4c453a7b92336cc39476588bf094dd5b31",
    "verified_commit": "74e76ed140a6daebb090cd0874811298f9b4f665",
    "scope": "real Next server-action login to the PostgreSQL session lifecycle",
    "evidence": [
      {
        "url": "https://github.com/Cat-Ghost-Community/1beng/actions/runs/42119920640",
        "job": "postgres-acceptance",
        "native_tests_passed": 66,
        "http_browser_check_groups_passed": 13,
        "commands": [
          "npm run test:postgres",
          "PG_HTTP_BROWSER=1 npm run test:postgres:http"
        ]
      }
    ],
    "limits": [
      "Only the explicit loopback disposable integration database/schema and gated routes were accepted.",
      "No customer-data cutover, financial-module migration or customer-target deployment is certified."
    ]
  }
};
const EXTENSIONS=['.ts','.tsx','.mts','.cts','.js','.jsx','.cjs','.mjs','.json'];
const slash=value=>value.split(path.sep).join('/');
const unique=values=>[...new Set(values)].sort();
const sourceText=filename=>fs.readFileSync(filename,'utf8').replace(/\r\n/g,'\n');

function walk(root,directory){
 const target=path.join(root,directory);if(!fs.existsSync(target))return [];
 return fs.readdirSync(target,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en')).flatMap(entry=>{
  const filename=path.join(directory,entry.name);
  if(entry.isSymbolicLink())return [];
  return entry.isDirectory()?walk(root,filename):/\.(?:[cm]?[jt]sx?|sh|json)$/.test(entry.name)?[slash(filename)]:[];
 });
}
function hasExport(node){return node.modifiers?.some(modifier=>modifier.kind===ts.SyntaxKind.ExportKeyword)??false;}
function directive(statements,value){return statements.some(node=>ts.isExpressionStatement(node)&&ts.isStringLiteral(node.expression)&&node.expression.text===value);}
function lineOf(tree,node){return tree.getLineAndCharacterOfPosition(node.getStart(tree)).line+1;}
function routeFor(filename,leaf){
 const result=filename.replace(/^src\/app\/?/,'').replace(new RegExp('(?:^|/)'+leaf+'\\.(?:tsx?|jsx?)$'),'').split('/').filter(segment=>segment&&!/^\(.*\)$/.test(segment)&&!segment.startsWith('@'));
 return '/'+result.join('/');
}
function resolveLocal(root,from,specifier,known,configuration={baseUrl:'.',paths:{'@/*':['src/*']}}){
 const stems=[];
 if(specifier.startsWith('.'))stems.push(path.resolve(root,path.dirname(from),specifier));
 else for(const [pattern,targets] of Object.entries(configuration.paths)){
  const star=pattern.indexOf('*'),prefix=star<0?pattern:pattern.slice(0,star),suffix=star<0?'':pattern.slice(star+1);
  if(star<0?specifier===pattern:specifier.startsWith(prefix)&&specifier.endsWith(suffix))for(const target of targets)stems.push(path.resolve(root,configuration.baseUrl,target.replace('*',specifier.slice(prefix.length,suffix?specifier.length-suffix.length:undefined))));
 }
 if(!stems.length)return {external:specifier};
 for(const stem of stems){const relative=slash(path.relative(root,stem));
  if(relative==='..'||relative.startsWith('../'))return {unresolved:'outside_repository'};
  const replacements=/\.[cm]?jsx?$/.test(relative)?[relative.replace(/\.[cm]?jsx?$/,'.ts'),relative.replace(/\.[cm]?jsx?$/,'.tsx')]:[];
  for(const candidate of [relative,...replacements,...EXTENSIONS.map(ext=>relative+ext),...EXTENSIONS.map(ext=>relative+'/index'+ext)])if(known.has(candidate))return {target:candidate};
  if(fs.existsSync(stem)&&fs.statSync(stem).isFile())return {asset:relative};
 }
 return {unresolved:'unresolved_local_import'};
}
function httpReferences(text){
 return unique([...text.matchAll(/\/api\/[A-Za-z0-9_./[\]-]*/g)].map(match=>match[0].replace(/\/$/,'')));
}
function parseModule(root,filename,known,configuration){
 const text=sourceText(path.join(root,filename)),shell=filename.endsWith('.sh');
 const result={file:filename,kind:shell?'shell':filename.startsWith('tests/')?'test':filename.startsWith('scripts/')?'tool':filename.startsWith('src/app/')?'application':filename.startsWith('src/lib/')?'library':'component',sha256:crypto.createHash('sha256').update(text).digest('hex'),imports:[],exports:[],actions:[],client:false,module_server:false,http_references:[],dynamic_expressions:[],storage_signals:[],transaction_signals:[]};
 if(filename.endsWith('.json')){result.kind=/schema/.test(filename)?'schema_artifact':'source_data';return result;}
 const add=(specifier,kind,line,typeOnly=false,requireRoot=false)=>{
  const resolved=resolveLocal(root,requireRoot?'package-entry.cjs':filename,specifier,known,configuration);
  result.imports.push({specifier,kind,line,type_only:typeOnly,...resolved});
  if(!typeOnly&&specifier==='node:sqlite')result.storage_signals.push({engine:'sqlite',kind:'native_import',line});
  if(!typeOnly&&specifier==='pg')result.storage_signals.push({engine:'postgres',kind:'native_import',line});
 };
 if(shell){
  for(const match of text.matchAll(/(?:source|\.|exec\s+bash)\s+["']?\$(?:WIZARD_ROOT|ROOT)\/((?:deploy\/wizard\/)?[A-Za-z0-9_.-]+\.sh)/g))add(('../'.repeat(Math.max(0,filename.split('/').length-1))||'./')+match[1],'shell_source_or_delegate',text.slice(0,match.index).split('\n').length);
  for(const match of text.matchAll(/run_app\s+[^\n]*?\s(deployment|recovery-set|scheduled|backup|restore)\b/g))result.dynamic_expressions.push({kind:'compiled_tool_dispatch',line:text.slice(0,match.index).split('\n').length,tool:match[1]});
  return result;
 }
 const tree=ts.createSourceFile(filename,text,ts.ScriptTarget.Latest,true,filename.endsWith('x')?ts.ScriptKind.TSX:/\.[cm]?js$/.test(filename)?ts.ScriptKind.JS:ts.ScriptKind.TS);
 let rootRequire=false;
 function findRequireBase(node){
  if(ts.isVariableDeclaration(node)&&node.name.getText(tree)==='require'&&node.initializer&&ts.isCallExpression(node.initializer)&&node.initializer.expression.getText(tree)==='createRequire'){
   const argument=node.initializer.arguments[0];
   if(argument&&ts.isCallExpression(argument)&&argument.expression.getText(tree)==='path.join'&&argument.arguments[0]?.getText(tree)==='process.cwd()'&&argument.arguments[1]&&ts.isStringLiteral(argument.arguments[1])&&argument.arguments[1].text==='package.json')rootRequire=true;
  }
  ts.forEachChild(node,findRequireBase);
 }
 findRequireBase(tree);
 result.client=directive(tree.statements,'use client');result.module_server=directive(tree.statements,'use server');
 const namedFunction=node=>node.name?.getText(tree)||(ts.isVariableDeclaration(node.parent)?node.parent.name.getText(tree):hasExport(node)?'default':'anonymous');
 function visit(node){
  if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)){
   const clause=node.importClause,allType=clause?.isTypeOnly||(clause?.namedBindings&&ts.isNamedImports(clause.namedBindings)&&!clause.name&&clause.namedBindings.elements.length>0&&clause.namedBindings.elements.every(element=>element.isTypeOnly));
   add(node.moduleSpecifier.text,'import',lineOf(tree,node),!!allType);
  }
  if(ts.isExportDeclaration(node)){
   if(node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))add(node.moduleSpecifier.text,'reexport',lineOf(tree,node),node.isTypeOnly);
   if(node.exportClause&&ts.isNamedExports(node.exportClause))for(const item of node.exportClause.elements)if(!node.isTypeOnly&&!item.isTypeOnly)result.exports.push({name:item.name.text,line:lineOf(tree,item),kind:'reexport'});
  }
  if(ts.isImportTypeNode(node)&&ts.isLiteralTypeNode(node.argument)&&ts.isStringLiteral(node.argument.literal))add(node.argument.literal.text,'import_type',lineOf(tree,node),true);
  if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(node.expression)&&node.expression.text==='require')){
   const kind=node.expression.kind===ts.SyntaxKind.ImportKeyword?'dynamic_import':'require',argument=node.arguments[0];
   if(argument&&(ts.isStringLiteral(argument)||ts.isNoSubstitutionTemplateLiteral(argument)))add(argument.text,kind,lineOf(tree,node),false,kind==='require'&&rootRequire);
   else result.dynamic_expressions.push({kind,line:lineOf(tree,node)});
  }
  if((ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node))&&hasExport(node))result.exports.push({name:node.name?.text??'default',line:lineOf(tree,node),kind:ts.isClassDeclaration(node)?'class':'function'});
  if(ts.isVariableStatement(node)&&hasExport(node))for(const declaration of node.declarationList.declarations)result.exports.push({name:declaration.name.getText(tree),line:lineOf(tree,declaration),kind:declaration.initializer&&(ts.isArrowFunction(declaration.initializer)||ts.isFunctionExpression(declaration.initializer))?'function':'value'});
  if((ts.isFunctionDeclaration(node)||ts.isFunctionExpression(node)||ts.isArrowFunction(node))&&node.body&&ts.isBlock(node.body)&&directive(node.body.statements,'use server'))result.actions.push({name:namedFunction(node),line:lineOf(tree,node)});
  if(ts.isCallExpression(node)||ts.isNewExpression(node)){
   const called=node.expression.getText(tree);
   if(/^(?:getDb|DatabaseSync)$/.test(called))result.storage_signals.push({engine:'sqlite',kind:called,line:lineOf(tree,node)});
   if(/\.prepare$/.test(called)&&/\bDatabaseSync\b/.test(text))result.storage_signals.push({engine:'sqlite',kind:'typed_sync_prepare',line:lineOf(tree,node)});
   if(/^(?:createPostgresDatabase|postgresDurableOperation)$/.test(called))result.storage_signals.push({engine:'postgres',kind:called,line:lineOf(tree,node)});
   if(/\.query$/.test(called)&&/\bPostgresDatabase\b/.test(text))result.storage_signals.push({engine:'postgres',kind:'typed_async_query',line:lineOf(tree,node)});
   if(/^(?:atomic|readSnapshot|beginSqliteWrite|durableOperation|postgresDurableOperation|withBackupPreparation)$/.test(called)||/\.transaction$/.test(called))result.transaction_signals.push({name:called,line:lineOf(tree,node)});
  }
  if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))result.http_references.push(...httpReferences(node.text));
  ts.forEachChild(node,visit);
 }
 visit(tree);
 if(result.module_server)for(const item of result.exports)if(item.kind==='function')result.actions.push({name:item.name,line:item.line});
 result.actions=[...new Map(result.actions.map(action=>[action.line+':'+action.name,action])).values()];
 result.http_references=unique(result.http_references);
 return result;
}
function routeMatches(reference,route){
 if(reference===route)return true;
 const pattern=route.split('/').map(segment=>/^\[\[?\.\.\./.test(segment)?'.*':/^\[/.test(segment)?'[^/]+':segment.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('/');
 return new RegExp('^'+pattern+'/?$').test(reference);
}
function inventory(root,reviewedAcceptance=REVIEWED_ACCEPTANCE){
 const inputs=unique([...walk(root,'src'),...walk(root,'scripts'),...walk(root,'tests'),...walk(root,'deploy'),...['setup.sh','install.sh','manage.sh','deploy.sh'].filter(file=>fs.existsSync(path.join(root,file)))]),known=new Set(inputs);
 const parsed=fs.existsSync(path.join(root,'tsconfig.json'))?ts.readConfigFile(path.join(root,'tsconfig.json'),ts.sys.readFile):{config:{compilerOptions:{}}};if(parsed.error)throw Error('Unable to read repository TypeScript configuration');
 const configuration={baseUrl:parsed.config.compilerOptions?.baseUrl??'.',paths:parsed.config.compilerOptions?.paths??{}},configurationFiles=['tsconfig.json','package.json','next.config.ts'].filter(file=>fs.existsSync(path.join(root,file))).map(file=>({file,sha256:crypto.createHash('sha256').update(sourceText(path.join(root,file))).digest('hex')}));
 const modules=inputs.map(filename=>parseModule(root,filename,known,configuration)),byFile=new Map(modules.map(module=>[module.file,module]));
 const toolMap={};const buildTool=byFile.get('scripts/build-database-tools.cjs');if(buildTool){const tree=ts.createSourceFile(buildTool.file,sourceText(path.join(root,buildTool.file)),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);function visit(node){if(ts.isPropertyAssignment(node)&&node.name.getText(tree)==='entryPoints'&&ts.isObjectLiteralExpression(node.initializer))for(const item of node.initializer.properties)if(ts.isPropertyAssignment(item)&&ts.isStringLiteral(item.initializer))toolMap[item.name.getText(tree).replace(/^['"]|['"]$/g,'')]=item.initializer.text;ts.forEachChild(node,visit);}visit(tree);}
 for(const sourceModule of modules)for(const expression of sourceModule.dynamic_expressions)if(expression.kind==='compiled_tool_dispatch'&&toolMap[expression.tool])sourceModule.imports.push({specifier:expression.tool,kind:'compiled_tool',line:expression.line,type_only:false,...(known.has(toolMap[expression.tool])?{target:toolMap[expression.tool]}:{unresolved:'compiled_tool_source_missing',expected_source:toolMap[expression.tool]})});
 const closureCache=new Map();
 function closure(start){if(closureCache.has(start))return closureCache.get(start);const visited=new Set(),pending=[start];while(pending.length){const file=pending.pop();if(visited.has(file))continue;visited.add(file);for(const edge of byFile.get(file)?.imports??[])if(edge.target&&!edge.type_only)pending.push(edge.target);}const result=[...visited].sort();closureCache.set(start,result);return result;}
 const tests=modules.filter(module=>module.kind==='test'||module.file.startsWith('scripts/')&&/(?:browser|smoke|acceptance|test-|load-test)/.test(path.basename(module.file))),testClosures=new Map(tests.map(test=>[test.file,new Set(closure(test.file))]));
 const packageJson=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')),scriptEntrypoints=new Set(Object.values(toolMap));
 for(const command of Object.values(packageJson.scripts??{}))for(const match of String(command).matchAll(/\bscripts\/[A-Za-z0-9_./-]+\.(?:[cm]?js|ts)\b/g))scriptEntrypoints.add(match[0]);
 const entrypoints=[];
 function frameworkDependencies(filename,kind){
  if(!['api_route','page','layout','server_action'].includes(kind))return [];
  const dependencies=['src/proxy.ts','src/middleware.ts'].filter(file=>byFile.has(file));
  if(kind!=='api_route')for(let directory=path.posix.dirname(filename);directory==='src/app'||directory.startsWith('src/app/');directory=path.posix.dirname(directory))for(const extension of ['tsx','ts','jsx','js']){const candidate=directory+'/layout.'+extension;if(candidate!==filename&&byFile.has(candidate))dependencies.push(candidate);}
  return unique(dependencies);
 }
 function entry(module,kind,options={}){
  const framework=frameworkDependencies(module.file,kind),runtime=unique([module.file,...framework].flatMap(file=>closure(file))),services=runtime.filter(file=>/^src\/lib\/(?!db\/)/.test(file)),repositories=runtime.filter(file=>/^src\/lib\/db\//.test(file)||byFile.get(file)?.storage_signals.length),transactions=runtime.filter(file=>byFile.get(file)?.transaction_signals.length);
  const sqlite=runtime.filter(file=>byFile.get(file)?.storage_signals.some(signal=>signal.engine==='sqlite')),postgres=runtime.filter(file=>/^src\/lib\/db\/postgres/.test(file)||byFile.get(file)?.storage_signals.some(signal=>signal.engine==='postgres'));
  const directTests=tests.filter(test=>test.imports.some(edge=>edge.target===module.file&&!edge.type_only)).map(test=>test.file),transitiveTests=tests.filter(test=>testClosures.get(test.file).has(module.file)).map(test=>test.file);
  const id=kind+':'+module.file+(options.action?'#'+options.action:''),runtimeDigest=crypto.createHash('sha256');for(const source of [...runtime.map(file=>({file,sha256:byFile.get(file).sha256})),...configurationFiles])runtimeDigest.update(source.file+'\0'+source.sha256+'\n');const runtimeHash=runtimeDigest.digest('hex'),review=reviewedAcceptance[id];
  const acceptance=review?{...review,status:review.runtime_source_sha256===runtimeHash?review.status:'evidence_source_changed',evidence_current:review.runtime_source_sha256===runtimeHash}:{status:'not_verified',evidence_current:false,evidence:[]};
  const handlers=options.handlers?.map(handler=>({...handler,postgres_acceptance:acceptance.evidence_current&&acceptance.verified_handlers?.includes(handler.method)?'isolated_pg_verified':'not_verified'}));
  if(handlers){acceptance.verified_handlers=handlers.filter(handler=>handler.postgres_acceptance==='isolated_pg_verified').map(handler=>handler.method);acceptance.unverified_handlers=handlers.filter(handler=>handler.postgres_acceptance!=='isolated_pg_verified').map(handler=>handler.method);acceptance.entire_route_verified=acceptance.evidence_current&&acceptance.unverified_handlers.length===0;}
  entrypoints.push({id,kind,file:module.file,...options,...(handlers?{handlers}:{}),client:module.client,runtime_source_sha256:runtimeHash,implicit_framework_dependencies:framework,runtime_dependencies:runtime,type_only_dependencies:unique(runtime.flatMap(file=>(byFile.get(file)?.imports??[]).filter(edge=>edge.type_only&&edge.target).map(edge=>edge.target))),services,repositories,transaction_modules:transactions,sqlite_dependencies:sqlite,postgres_dependencies:postgres,dynamic_or_unresolved:runtime.flatMap(file=>[...(byFile.get(file)?.imports??[]).filter(edge=>edge.unresolved).map(edge=>({file,...edge})),...(byFile.get(file)?.dynamic_expressions??[]).map(expression=>({file,...expression}))]),test_references:{direct_source:directTests,transitive_source:transitiveTests,literal_http:[]},postgres:{implementation:acceptance.evidence_current?'implemented_for_reviewed_isolated_scope':postgres.length?(sqlite.length?'mixed_dependency_code_present_unverified':'native_dependency_code_present_unverified'):sqlite.length?'sqlite_dependency_unported_or_unverified':'no_database_dependency_detected',acceptance,production_ready:false}});
 }
 for(const sourceModule of modules){
  if(/^src\/app\/.*\/route\.[jt]s$/.test(sourceModule.file))entry(sourceModule,'api_route',{route:routeFor(sourceModule.file,'route'),handlers:sourceModule.exports.filter(item=>API_METHODS.has(item.name)).map(item=>({method:item.name,line:item.line}))});
  else if(/^src\/app\/(?:.*\/)?page\.[jt]sx?$/.test(sourceModule.file))entry(sourceModule,'page',{route:routeFor(sourceModule.file,'page')});
  else if(/^src\/app\/(?:.*\/)?layout\.[jt]sx?$/.test(sourceModule.file))entry(sourceModule,'layout',{route:routeFor(sourceModule.file,'layout')});
  if(/^src\/(?:proxy|middleware)\.[jt]s$/.test(sourceModule.file))entry(sourceModule,'request_proxy');
  for(const action of sourceModule.actions)entry(sourceModule,'server_action',{action:action.name,line:action.line});
  if(scriptEntrypoints.has(sourceModule.file))entry(sourceModule,'command_tool');
  if(sourceModule.kind==='shell')entry(sourceModule,'deployment_script');
 }
 const apis=entrypoints.filter(item=>item.kind==='api_route');
 for(const item of entrypoints){item.http_dependencies=unique(item.runtime_dependencies.flatMap(file=>byFile.get(file)?.http_references??[])).flatMap(reference=>apis.filter(api=>routeMatches(reference,api.route)).map(api=>({reference,file:api.file,route:api.route})));
  if(item.kind==='api_route')item.test_references.literal_http=tests.filter(test=>test.http_references.some(reference=>routeMatches(reference,item.route))).map(test=>test.file);
 }
 const sourceDigest=crypto.createHash('sha256');for(const sourceModule of [...modules,...configurationFiles])sourceDigest.update(sourceModule.file+'\0'+sourceModule.sha256+'\n');
 const counts={input_files:modules.length,api_route_files:apis.length,api_handlers:apis.reduce((n,item)=>n+item.handlers.length,0),pages:entrypoints.filter(item=>item.kind==='page').length,layouts:entrypoints.filter(item=>item.kind==='layout').length,server_actions:entrypoints.filter(item=>item.kind==='server_action').length,command_tools:entrypoints.filter(item=>item.kind==='command_tool').length,deployment_scripts:entrypoints.filter(item=>item.kind==='deployment_script').length,local_runtime_edges:modules.reduce((n,item)=>n+item.imports.filter(edge=>edge.target&&!edge.type_only).length,0),type_only_edges:modules.reduce((n,item)=>n+item.imports.filter(edge=>edge.target&&edge.type_only).length,0),unresolved_local_edges:modules.reduce((n,item)=>n+item.imports.filter(edge=>edge.unresolved).length,0),nonliteral_dynamic_expressions:modules.reduce((n,item)=>n+item.dynamic_expressions.filter(expression=>expression.kind!=='compiled_tool_dispatch').length,0),reviewed_entrypoint_acceptances:entrypoints.filter(item=>item.postgres.acceptance.evidence_current).length};
 counts.reviewed_handler_acceptances=apis.reduce((sum,item)=>sum+item.handlers.filter(handler=>handler.postgres_acceptance==='isolated_pg_verified').length,0);
 counts.partially_verified_api_routes=apis.filter(item=>item.postgres.acceptance.evidence_current&&!item.postgres.acceptance.entire_route_verified).length;
 return {format_version:FORMAT_VERSION,source_tree_sha256:sourceDigest.digest('hex'),configuration_files:configurationFiles,method:{analysis:'TypeScript compiler AST; runtime/type-only import graph; module-level transitive reachability; literal HTTP references; no application execution',roots:['src','scripts','tests','deploy','setup.sh','install.sh','manage.sh','deploy.sh'],module_resolution:configuration,verification:'Test references are not executed or passing tests; default acceptance is not_verified.',runtime:'Default supported deployment remains SQLite. PostgreSQL live/pilot support must be explicitly gated and verified; static references never enable it.',limitations:['Graph is module-level, not a function-sensitive execution proof; unused imports and mutually exclusive engine branches remain conservatively reachable.','Nonliteral imports/requires, computed paths, runtime-generated SQL and dependency injection cannot be resolved statically; listed explicitly.','Literal HTTP references are reference hints, not proof of requested methods, authentication, successful browser execution or full dynamic URL coverage.','External packages/assets are recorded but their internal graphs are not traversed. Symlinked input files/directories are excluded.','Shell imports/tool dispatch and createRequire bases are recognized only for explicit managed patterns; native systemd and shell behavior still need actual-host tests.','SQLite/PG reachability and test counts are dependency metrics, not defect counts or a migration completion percentage.']},counts,compiled_tools:toolMap,entrypoints:entrypoints.sort((a,b)=>a.id.localeCompare(b.id,'en')),modules};
}
function acceptanceLabel(entry){const accepted=entry.postgres.acceptance;return accepted.evidence_current&&accepted.unverified_handlers?.length?accepted.status+' ('+accepted.verified_handlers.join('/')+' only; '+accepted.unverified_handlers.join('/')+' not_verified)':accepted.status;}
function markdown(report){
 const c=report.counts,rows=report.entrypoints.filter(item=>['api_route','page','server_action','command_tool','deployment_script'].includes(item.kind));
 return '# PostgreSQL migration inventory\n\nGenerated from actual repository source; rerun after source changes. **Not a production-readiness certificate.**\n\n```bash\nnode scripts/postgres-migration-inventory.cjs\nnode scripts/postgres-migration-inventory.cjs --check\n```\n\nSource-tree digest: `'+report.source_tree_sha256+'`. Complete machine-readable graph: [docs/postgres-migration-coverage.json](docs/postgres-migration-coverage.json). The generator never loads application modules, opens a database or reads customer data/secrets.\n\n## Measured footprint\n\n| Measure | Count |\n| --- | ---: |\n'+Object.entries(c).map(([key,value])=>'| '+key.replaceAll('_',' ')+' | '+value+' |').join('\n')+'\n\n## Interpretation\n\nRuntime imports and type-only imports are separated; proxy and ancestor-layout dependencies are included implicitly, and accepted entrypoints are bound to their transitive runtime/configuration fingerprints. Hashes normalize CRLF to LF. Each entry records source services, storage/transaction modules, transitive dependencies, literal HTTP links, unresolved dynamic expressions, and direct/transitive test references. Every source module is retained in the JSON, including modules without a discovered entrypoint. Module reachability conservatively includes legacy SQLite fallback and gated PostgreSQL branches; it does not prove that both execute in one request.\n\nDefault PostgreSQL acceptance is **not_verified**. New native services or an opt-in route remain unverified until explicit reviewed execution evidence is recorded. Existing native PostgreSQL tests support only their actual isolated behaviors; no result is inferred from a file name/import. `production_ready` remains false in this inventory.\n\n## Entrypoint coverage\n\nSQLite/PG columns count reachable source modules carrying database signals; these are dependency counts, not defect counts or percentages. Details and complete paths are in the JSON.\n\n| Entry | Type | Route/action | SQLite modules | PG modules | Reviewed acceptance |\n| --- | --- | --- | ---: | ---: | --- |\n'+rows.map(item=>'| `'+item.file+'` | '+item.kind+' | '+(item.route??item.action??'—')+' | '+item.sqlite_dependencies.length+' | '+item.postgres_dependencies.length+' | '+acceptanceLabel(item)+' |').join('\n')+'\n\n## Reviewed isolated scope\n\n[PostgreSQL CI run42119920640](https://github.com/Cat-Ghost-Community/1beng/actions/runs/42119920640) passed native66 tests and13 actual HTTP/browser check groups at code commit `74e76ed140a6daebb090cd0874811298f9b4f665`. Source-bound records accept only auth login/logout/password, customer collection GET/POST, customer-id GET, website health, root layout, login/customer SSR pages and the login server action. Customer-id POST remains **not_verified**; lookup/merge/financial modules and every other route receive no acceptance claim. The native schema/migration and authentication foundations exist; remaining concerns below describe their application-wide completion. Acceptance means a disposable loopback integration, never production cutover or customer-host certification. Later changes to a reviewed entrypoint, its runtime/framework dependencies or configuration invalidate that record.\n\n## Explicit limits\n\n'+report.method.limitations.map(value=>'- '+value).join('\n')+'\n\n## Remaining migration concerns\n\n1. Extend the implemented/verified native schema and versioned-migration foundation to full view/default/unique/CHECK/trigger semantics for every remaining domain.\n2. Extend the implemented/verified async auth/session and customer SSR/HTTP slice to the remaining application without hidden synchronous SQLite calls.\n3. Financial command services and immutable source-to-ledger/obligation invariants.\n4. Operational services: inventory, repair, purchasing, returns and other existing modules.\n5. Authoritative reports, statements, pagination, exports/imports and reconciliation.\n6. Background operations, installer/health and native PostgreSQL backup/object recovery.\n7. Reviewed cutover rehearsal, source preservation, sessions, audit and recovery plan.\n8. Application-wide PostgreSQL HTTP/browser/security/concurrency/failure/workload acceptance beyond the explicitly verified isolated slice.\n\nThese concerns describe separate work boundaries; they are not estimates of effort or a promise of complete commercial accounting. Protected historical approvals and customer-target operation acceptance remain separate.\n';
}
function main(){
 const args=process.argv.slice(2);if(args.some(value=>!['--check','--markdown','--help'].includes(value)))throw Error('Use --check to verify and --markdown for optional local documentation');
 if(args.includes('--help')){console.log('Static PostgreSQL source migration graph: node scripts/postgres-migration-inventory.cjs [--check] [--markdown]');return;}
 const root=fs.realpathSync(path.resolve(__dirname,'..')),report=inventory(root),files={'docs/postgres-migration-coverage.json':JSON.stringify(report,null,2)+'\n'};
 if(args.includes('--markdown'))files['POSTGRES_MIGRATION_INVENTORY.md']=markdown(report);
 for(const [filename,content] of Object.entries(files)){const target=path.join(root,filename);if(args.includes('--check')){if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==content)throw Error('Migration inventory is stale: '+filename);}else fs.writeFileSync(target,content);}
 console.log(JSON.stringify({status:args.includes('--check')?'verified_current_source':'generated',...report.counts}));
}
module.exports={inventory,parseModule,resolveLocal,routeMatches};
if(require.main===module)try{main();}catch(error){console.error(error.message);process.exitCode=1;}
