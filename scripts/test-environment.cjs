// Test storage stays outside the repository by default. A dedicated disk can
// be selected explicitly; it must never contain the business database.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const workspace=path.resolve(process.env.REPAID_TEST_WORKSPACE??process.env.REPAID_TEST_TMPDIR??fs.mkdtempSync(path.join(os.tmpdir(),'repaid-tests-')));
const business=fs.existsSync('data')?fs.realpathSync('data'):path.resolve('data');
const overlapsBusiness=root=>{const key=value=>process.platform==='win32'?value.toLowerCase():value,left=key(root),right=key(business);return left===right||left.startsWith(right+path.sep)||right.startsWith(left+path.sep);};
if(path.dirname(workspace)===workspace||overlapsBusiness(workspace))throw Error('Test workspace must be separate from business data');
let existing;try{existing=fs.lstatSync(workspace);}catch(error){if(error.code!=='ENOENT')throw error;}
if(existing?.isSymbolicLink())throw Error('Test workspace must be separate from business data');
fs.mkdirSync(workspace,{recursive:true,mode:0o700});
if(fs.lstatSync(workspace).isSymbolicLink()||overlapsBusiness(fs.realpathSync(workspace)))throw Error('Test workspace must be separate from business data');
const privateRoot=process.env.REPAID_TEST_WORKSPACE=fs.realpathSync(workspace);
const temporary=path.resolve(process.env.REPAID_TEST_TMPDIR??path.join(privateRoot,'tmp'));
fs.mkdirSync(temporary,{recursive:true,mode:0o700});if(fs.lstatSync(temporary).isSymbolicLink())throw new Error('Test temporary directory cannot be a symlink');
if(fs.realpathSync(temporary)!==privateRoot&&!fs.realpathSync(temporary).startsWith(privateRoot+path.sep))throw Error('Test temporary directory must stay inside its private workspace');
process.env.TEMP=process.env.TMP=process.env.TMPDIR=fs.realpathSync(temporary);
process.env.REPAID_TEST_CONTEXT='1';
// A module imported before a test's own fixture setup must never resolve the
// real ./data database. Child workers retain only an explicitly isolated path.
if(process.env.REPAID_DATA_DIR&&process.env.REPAID_DATA_DIR!==process.env.REPAID_TEST_DEFAULT_DATA_DIR){
 const selected=path.resolve(process.env.REPAID_DATA_DIR);
 let resolved;try{resolved=fs.realpathSync(selected);}catch{throw new Error('Test data must stay inside the private disposable workspace');}
 if(!resolved.startsWith(privateRoot+path.sep))throw new Error('Test data must stay inside the private disposable workspace');
}else process.env.REPAID_TEST_DEFAULT_DATA_DIR=process.env.REPAID_DATA_DIR=fs.mkdtempSync(path.join(fs.realpathSync(temporary),'repaid-test-default-'));
if(!process.env.REPAID_BACKUP_WORK_DIR){
 const root=path.join(privateRoot,'backup-work');fs.mkdirSync(root,{recursive:true,mode:0o700});
 if(fs.lstatSync(root).isSymbolicLink())throw new Error('Test backup workspace cannot be a symlink');
 process.env.REPAID_BACKUP_WORK_DIR=fs.realpathSync(root);
}
