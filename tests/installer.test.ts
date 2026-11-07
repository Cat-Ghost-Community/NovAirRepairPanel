import {it,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync,spawnSync} from 'node:child_process';
const require=createRequire(path.join(process.cwd(),'package.json'));
const host=require('./deploy/wizard/host.cjs') as {initialize:(o:Record<string,unknown>)=>unknown;readEnvironment:(f:string)=>Record<string,string>;hostReserved:(h:string,f:string[])=>boolean};
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'repaid-installer-'));
const bash=process.platform==='win32'?path.resolve(execFileSync('git',['--exec-path'],{encoding:'utf8'}).trim(),'../../..','bin/bash.exe'):'bash';
const unix=(value:string)=>process.platform==='win32'?value.replaceAll('\\','/').replace(/^([A-Za-z]):/,(_,drive:string)=>'/'+drive.toLowerCase()):value;
function shell(script:string,extra:Record<string,string>={}){return spawnSync(bash,['--noprofile','--norc','-c','source "$PROJECT/deploy/wizard/core.sh"; '+script],{encoding:'utf8',windowsHide:true,timeout:20000,env:{...process.env,PROJECT:unix(process.cwd()),FIXTURE:unix(directory),NO_COLOR:'1',...extra}});}
after(()=>{const resolved=fs.realpathSync(directory);assert.equal(path.dirname(resolved),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('repaid-installer-'));fs.rmSync(resolved,{recursive:true,force:true});});
it('parses every installer entry/module with real Bash',()=>{
 for(const file of ['setup.sh','install.sh','deploy.sh','manage.sh',...fs.readdirSync('deploy/wizard').filter(name=>name.endsWith('.sh')).map(name=>'deploy/wizard/'+name)]){const child=spawnSync(bash,['-n',file],{encoding:'utf8',windowsHide:true});assert.equal(child.status,0,child.stderr);}
});
it('renders the working one-command plan without root or host mutation',()=>{
 const child=shell('cd "$PROJECT"; REPAID_DATA_DIR=/var/lib/repaid REPAID_BACKUP_DIR=/var/backups/repaid REPAID_APP_DIR=/opt/repaid SSL_TYPE=ip SERVER_IP=192.0.2.20 bash setup.sh --plan');assert.equal(child.status,0,child.stderr);assert.match(child.stdout,/https:\/\/192\.0\.2\.20/);assert.match(child.stdout,/Ref: main/);assert.match(child.stdout,/No database wipe/);
 for(const file of ['setup.sh','install.sh','manage.sh','deploy.sh']){const help=shell('cd "$PROJECT"; bash "$ENTRY" --help',{ENTRY:file});assert.equal(help.status,0,help.stderr);assert.match(help.stdout,/Repaid/);}
});
it('defaults a downloaded bootstrap to HTTPS while preserving explicit SSH and repository choices',()=>{
 const entry=path.join(directory,'downloaded-setup.sh');fs.copyFileSync('setup.sh',entry);
 for(const [extra,args,expected] of [
  [{},[],/https:\/\/github\.com\/Cat-Ghost-Community\/NovAirRepairPanel\.git/],
  [{REPAID_SSH_IDENTITY_FILE:'/root/.ssh/deploy'},[],/git@github\.com:Cat-Ghost-Community\/NovAirRepairPanel\.git/],
  [{},['--repo','https://github.com/fixture/custom.git'],/https:\/\/github\.com\/fixture\/custom\.git/],
 ] as [Record<string,string>,string[],RegExp][]){
  const environment={...process.env,...extra};delete environment.REPAID_REPO;
  const child=spawnSync(bash,[entry,'--plan',...args],{encoding:'utf8',windowsHide:true,env:environment});assert.equal(child.status,0,child.stderr);assert.match(child.stdout,expected);
 }
});
it('renders reference-style framed menus, narrow-terminal fallback and accurate completion guidance',()=>{
 const wide=shell('source "$PROJECT/manage.sh"; APP_DIR=/opt/repaid; DATA_DIR=/var/lib/repaid; BACKUP_DIR=/var/backups/repaid; SSL_TYPE=ip; SERVER_IP=192.0.2.20; COLUMNS=80; render_main_menu active; show_install_complete');assert.equal(wide.status,0,wide.stderr);assert.match(wide.stdout,/Main Menu/);assert.match(wide.stdout,/Smart Update/);assert.match(wide.stdout,/Management Panel/);assert.match(wide.stderr,/self-signed|Self-signed/);const borders=wide.stdout.split('\n').filter(line=>/^  [╔║╚]/u.test(line));assert.ok(borders.length>8);for(const line of borders)assert.equal([...line].length,66,line);
 const narrow=shell('COLUMNS=34; show_banner "Setup Wizard"; divider');assert.equal(narrow.status,0,narrow.stderr);assert.doesNotMatch(narrow.stdout,/[╔║╚]/u);for(const line of narrow.stdout.split('\n').filter(line=>line.startsWith('  ---')))assert.ok(line.length<=34);
});
it('retries invalid choices and input in place without exposing them as successful operations',()=>{
 fs.writeFileSync(path.join(directory,'answers'),'not-a-choice\n2\ninvalid domain\nrepairs.example.com\nq\n');
 const child=shell(`exec 4< "$FIXTURE/answers"; HAS_TTY=1; ask(){ local value; IFS= read -r -u 4 value || return 1; printf '%s' "$value"; }; [[ $(ask_choice Choice 0 '0 1 2') == 2 ]] || exit 1; [[ $(ask_validated Domain '' valid_domain 'Invalid domain') == repairs.example.com ]] || exit 1; ask_validated Domain '' valid_domain 'Invalid domain'; code=$?; [[ $code == 130 ]] || exit 1; echo guarded`);assert.equal(child.status,0,child.stderr);assert.match(child.stderr,/Choose one of/);assert.match(child.stderr,/Invalid domain/);assert.match(child.stdout,/guarded/);
});
it('runs read-only integrity inspection before any doctor HTTP probe can initialize a missing database',()=>{
 const child=shell('source "$PROJECT/manage.sh"; APP_DIR=/opt/repaid; load_config(){ :; }; assert_root_file(){ :; }; readlink(){ echo /opt/repaid/releases/fixture; }; assert_release(){ :; }; nginx(){ :; }; run_app(){ echo inspected >> "$FIXTURE/doctor-order"; return 1; }; backend_health(){ touch "$FIXTURE/doctor-http"; }; ! doctor; [[ -f "$FIXTURE/doctor-order" && ! -e "$FIXTURE/doctor-http" ]]');assert.equal(child.status,0,child.stderr);
});
if(process.platform!=='win32')it('completes real interactive PTY setup and hidden-password retry journeys',()=>{
 const child=spawnSync('python3',['scripts/installer-terminal-acceptance.py'],{encoding:'utf8',windowsHide:true,timeout:90000});assert.equal(child.status,0,child.stderr);assert.match(child.stdout,/3 real PTY journeys passed/);
});
it('rejects command injection, unsafe paths, credentials in repository URLs and invalid references',()=>{
 const child=shell(`set -e; valid_domain repairs.example.com; valid_domain xn--mgbh0fb.example; valid_ip 192.0.2.1; valid_port 3000; valid_path /var/lib/repaid;
 for value in 'x;touch /tmp/injected' 'bad_domain.com' '-bad.example' 'a..example' 'example.com.'; do ! valid_domain "$value"; done
 for value in '256.0.0.1' '01.2.3.4' '1.2.3.4;id' '1.2.3'; do ! valid_ip "$value"; done
 for value in / /opt/../data '/opt/repaid;id' /var//lib; do ! valid_path "$value"; done
 ! valid_repo 'https://token:secret@github.com/a/b.git'; ! valid_repo file:///etc/passwd; ! valid_ref '--upload-pack=evil'; ! valid_ref '../main'; ! valid_port 03000; ! valid_port 65536; echo guarded`);assert.equal(child.status,0,child.stderr);assert.match(child.stdout,/guarded/);
});
it('serializes reference-project shell configuration losslessly without executing its values',()=>{
 const child=shell(`set -e; value='literal $(touch SENTINEL) "quotes" spaces'; file="$FIXTURE/roundtrip.conf"; _config_write_line "$file" VALUE "$value"; cd "$FIXTURE"; source "$file"; [[ "$VALUE" == "$value" && ! -e SENTINEL ]]; echo retained`);assert.equal(child.status,0,child.stderr);assert.match(child.stdout,/retained/);
});
it('preserves original encryption keys and refuses changed data/backup paths',()=>{
 const app=path.join(directory,'app.env'),backup=path.join(directory,'backup.env'),options={app,backup,data:'/var/lib/repaid-unit',backups:'/var/backups/repaid-unit',origin:'https://repairs.example.com',gid:process.getgid?.()??0};host.initialize(options);const first=fs.readFileSync(app),second=fs.readFileSync(backup),appValues=host.readEnvironment(app),backupValues=host.readEnvironment(backup);assert.match(appValues.REPAID_ENCRYPTION_KEY,/^[a-f0-9]{64}$/);assert.notEqual(appValues.REPAID_ENCRYPTION_KEY,backupValues.REPAID_BACKUP_KEY);host.initialize(options);assert.deepEqual(fs.readFileSync(app),first);assert.deepEqual(fs.readFileSync(backup),second);
 assert.throws(()=>host.initialize({...options,data:'/var/lib/other'}),/reviewed/);assert.throws(()=>host.initialize({...options,backups:'/var/backups/other'}),/invalid/);assert.deepEqual(fs.readFileSync(app),first);assert.deepEqual(fs.readFileSync(backup),second);assert.equal(appValues.REPAID_DEMO_MODE,'0');assert.equal(appValues.REPAID_COOKIE_SECURE,'1');assert.equal(appValues.WEB_CONCURRENCY,'1');
});
it('detects another site hostname across multiline declarations, quotes and case without reserving wildcards',()=>{
 const file=path.join(directory,'other.nginx');fs.writeFileSync(file,'# server_name ignored.example;\nserver_name\n "Existing.Example.com" other.example;\nserver_name *.shared.example;\n');assert.equal(host.hostReserved('existing.example.com',[file]),true);assert.equal(host.hostReserved('ignored.example',[file]),false);assert.equal(host.hostReserved('new.shared.example',[file]),false);
});
it('rejects an insecure canonical origin without changing existing environment bytes',()=>{
 const target=path.join(directory,'app.env'),before=fs.readFileSync(target);assert.throws(()=>host.initialize({app:target,backup:target,data:'/wrong',backups:'/var/backups/test',origin:'http://insecure.example',gid:0}));assert.deepEqual(fs.readFileSync(target),before);
});
if(process.platform!=='win32')it('rejects a symlinked environment rather than changing its target',()=>{const link=path.join(directory,'linked.env'),target=path.join(directory,'app.env'),before=fs.readFileSync(target);fs.symlinkSync(target,link);assert.throws(()=>host.readEnvironment(link),/Untrusted/);fs.unlinkSync(link);assert.deepEqual(fs.readFileSync(target),before);});
it('never probes a different process occupying the selected port',()=>{
 const child=shell('APP_PORT=3000; systemctl(){ echo 123; }; ss(){ echo "LISTEN pid=999,"; }; sleep(){ :; }; curl(){ touch "$FIXTURE/foreign-probe"; }; ! backend_health; [[ ! -e "$FIXTURE/foreign-probe" ]]');assert.equal(child.status,0,child.stderr);
});
it('rejects a redirect or HTML success and accepts only the owned database health contract',()=>{
 const child=shell(`APP_PORT=3000; NODE_BIN="$TEST_NODE"; systemctl(){ echo 123; }; ss(){ echo 'LISTEN pid=123,'; }; sleep(){ :; }; curl(){ printf 'html\\n307'; }; ! backend_health; curl(){ printf '{"status":"ok","database":"ok"}\\n200'; }; backend_health`,{TEST_NODE:unix(process.execPath)});assert.equal(child.status,0,child.stderr);
});
it('blocks cutover while a real backup unit is active without killing that job',()=>{
 const child=shell(`source "$PROJECT/deploy/wizard/releases.sh"; systemctl(){ if [[ "$1" == show ]]; then echo active; else printf '%s\\n' "$*" >> "$FIXTURE/unit-actions"; fi; }; ! pause_backup_timers; ! grep -q 'stop repaid-backup.service' "$FIXTURE/unit-actions"; grep -q 'start repaid-backup.timer' "$FIXTURE/unit-actions"`);assert.equal(child.status,0,child.stderr);
});
it('pins a fetched commit even when the branch advances before candidate extraction',()=>{
 const child=shell(`set -e; source "$PROJECT/deploy/wizard/releases.sh"; mkdir "$FIXTURE/source" "$FIXTURE/app"; git -C "$FIXTURE/source" init -b main >/dev/null; git -C "$FIXTURE/source" config user.name InstallerFixture; git -C "$FIXTURE/source" config user.email installer@test.invalid; echo before > "$FIXTURE/source/content"; git -C "$FIXTURE/source" add content; git -C "$FIXTURE/source" commit -m before >/dev/null; expected=$(git -C "$FIXTURE/source" rev-parse HEAD); APP_DIR="$FIXTURE/app"; GIT_REPO="$FIXTURE/source"; GIT_REF=main; fetch_release >/dev/null; echo after > "$FIXTURE/source/content"; git -C "$FIXTURE/source" commit -am after >/dev/null; [[ "$RELEASE_SHA" == "$expected" ]]; git --git-dir="$APP_DIR/repository.git" show "$RELEASE_SHA:content"`);assert.equal(child.status,0,child.stderr);assert.equal(child.stdout.trim(),'before');
});
it('rejects build-hook tampering with management code before promoting it to root-owned releases',()=>{
 const child=shell(`set -eo pipefail; source "$PROJECT/deploy/wizard/releases.sh"; mkdir "$FIXTURE/control-source" "$FIXTURE/control-app"; cd "$FIXTURE/control-source"; git init -b main >/dev/null; git config user.name InstallerFixture; git config user.email installer@test.invalid; for file in setup.sh install.sh deploy.sh manage.sh deploy/wizard/core.sh deploy/wizard/host.cjs deploy/wizard/install.sh deploy/wizard/proxy.sh deploy/wizard/releases.sh deploy/repaid-backup.timer deploy/repaid-backup-check.timer; do mkdir -p "$(dirname "$file")"; cp "$PROJECT/$file" "$file"; done; git add .; git commit -m control >/dev/null; APP_DIR="$FIXTURE/control-app"; RELEASE_SHA=$(git rev-parse HEAD); git clone --bare . "$APP_DIR/repository.git" >/dev/null 2>&1; verify_control_sources "$PWD"; printf '\\n# tampered\\n' >> manage.sh; ! verify_control_sources "$PWD"; echo rejected`);assert.equal(child.status,0,child.stderr);assert.match(child.stdout,/rejected/);
});
if(process.platform!=='win32')it('atomically switches only an identified release and refuses a real current directory',()=>{
 const child=shell(`set -e; APP_DIR="$FIXTURE/links"; a=1111111111111111111111111111111111111111; b=2222222222222222222222222222222222222222; for sha in "$a" "$b"; do release="$APP_DIR/releases/$sha-123456abcdef"; mkdir -p "$release/.next" "$release/.database-tools"; echo "$sha" > "$release/RELEASE_SHA"; touch "$release/.next/BUILD_ID" "$release/.database-tools/deployment.cjs"; done; activate_link "$APP_DIR/releases/$a-123456abcdef"; activate_link "$APP_DIR/releases/$b-123456abcdef"; [[ $(readlink "$APP_DIR/current") == "$APP_DIR/releases/$b-123456abcdef" ]]; rm "$APP_DIR/current"; mkdir "$APP_DIR/current"; echo customer-evidence > "$APP_DIR/current/evidence"; ! activate_link "$APP_DIR/releases/$a-123456abcdef"; [[ $(cat "$APP_DIR/current/evidence") == customer-evidence ]]; echo preserved`);assert.equal(child.status,0,child.stderr);assert.match(child.stdout,/preserved/);
});
