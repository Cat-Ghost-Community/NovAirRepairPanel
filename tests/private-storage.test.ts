import {it,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {protectPrivateStorage,openPrivateFile} from '../src/lib/private-storage';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-private-acl-'));
after(()=>{const resolved=fs.realpathSync(directory);assert.equal(path.dirname(resolved),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('repaid-private-acl-'));fs.rmSync(resolved,{recursive:true,force:true});});

it('protects a private directory and literal file before writing bytes, with independently checked platform permissions',()=>{
 protectPrivateStorage(directory,'directory');
 const file=path.join(directory,"evidence';literal.txt"),handle=openPrivateFile(file);
 try{fs.writeSync(handle,'protected evidence');}finally{fs.closeSync(handle);}
 assert.equal(fs.readFileSync(file,'utf8'),'protected evidence');
 if(process.platform==='win32'){
  const script="$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; $acl=Get-Acl -LiteralPath $env:REPAID_ACL_PROBE; $allowed=@([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18','S-1-5-32-544'); $unexpected=@($acl.Access | Where-Object { $_.AccessControlType -eq 'Allow' -and $allowed -notcontains $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value }); @{protected=$acl.AreAccessRulesProtected;unexpected=$unexpected.Count;inherited=@($acl.Access | Where-Object IsInherited).Count} | ConvertTo-Json -Compress";
  const result=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:15000,env:{...process.env,REPAID_ACL_PROBE:file}}));
  assert.deepEqual(result,{protected:true,unexpected:0,inherited:0});
 }else{assert.equal(fs.statSync(file).mode&0o777,0o600);assert.equal(fs.statSync(directory).mode&0o777,0o700);}
});
it('rejects a symbolic directory instead of changing permissions on its destination',()=>{
 const link=path.join(directory,'linked');fs.symlinkSync(directory,link,process.platform==='win32'?'junction':'dir');
 try{assert.throws(()=>protectPrivateStorage(link,'directory'),/ordinary owned/);}finally{fs.unlinkSync(link);}
});
if(process.platform==='win32')it('fails closed and removes the new empty file if Windows ACL tools are unavailable',()=>{
 const original=process.env.PATH,target=path.join(directory,'must-not-exist.txt');
 try{process.env.PATH=path.join(directory,'missing-tools');assert.throws(()=>openPrivateFile(target),/permissions could not/);assert.equal(fs.existsSync(target),false);}finally{process.env.PATH=original;}
});
