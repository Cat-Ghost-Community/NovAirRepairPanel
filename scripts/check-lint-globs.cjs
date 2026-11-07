// Compatibility of the exact minimatch API used by typescript-estree's
// allowDefaultProject matcher. Application dependencies are unchanged.
const assert=require('node:assert/strict'),{createRequire}=require('node:module');
const parserRequire=createRequire(require.resolve('@typescript-eslint/typescript-estree/package.json'));
const matcher=parserRequire('minimatch'),version=parserRequire('minimatch/package.json').version;
assert.equal(version,'11.0.1');
const cases=[
 ['eslint.config.mjs','*.mjs',true],['.settings.ts','*.ts',true],
 ['src/app/invoices/[id]/page.tsx','src/app/**/page.tsx',true],
 ['src/app/repairs/group-receipt/[gid]/page.tsx','src/app/**/page.tsx',true],
 ['src/lib/format.ts','src/lib/*.ts',true],['src/lib/nested/file.ts','src/lib/*.ts',false],
 ['src/lib/format.ts','*.ts',false],['گزارش.ts','*.ts',true],
 ['scripts/test.cjs','scripts/*.cjs',true],['tests/payment.test.ts','tests/*.test.ts',true],
 ['src/lib/format.ts','src/app/**',false],['src/app/page.tsx','**/*.js',false],
];
for(const [file,pattern,expected] of cases)assert.equal(matcher.minimatch(file,pattern,{dot:true}),expected,file+' / '+pattern);
console.log(JSON.stringify({parser_matcher_version:version,compatible_cases:cases.length}));
