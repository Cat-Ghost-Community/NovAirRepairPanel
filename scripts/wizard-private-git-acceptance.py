"""Real HTTP Git authentication against a disposable private repository, never GitHub credentials."""
import base64, http.server, os, pathlib, subprocess, tempfile, threading, urllib.parse

assert os.name == 'posix' and os.getuid() == 0 and os.environ.get('REPAID_WIZARD_ACCEPTANCE') == '1'
project = pathlib.Path.cwd()
root = pathlib.Path(tempfile.mkdtemp(prefix='repaid-private-git-'))
source, exported, cache = root/'source', root/'exported', root/'app'
source.mkdir(); exported.mkdir(); cache.mkdir()
def git(*args):
    return subprocess.check_output(['git', *map(str, args)], text=True, stderr=subprocess.DEVNULL).strip()
git('init', '-b', 'main', source)
git('-C', source, 'config', 'user.name', 'Fixture')
git('-C', source, 'config', 'user.email', 'fixture@example.invalid')
(source/'evidence').write_text('independently expected private repository bytes')
git('-C', source, 'add', 'evidence'); git('-C', source, 'commit', '-m', 'fixture')
expected = git('-C', source, 'rev-parse', 'HEAD')
git('clone', '--bare', source, exported/'private.git')
git('--git-dir='+str(exported/'private.git'), 'update-server-info')
token='local-fixture-credential-only'
token_file=root/'token'; token_file.write_text(token+'\n'); token_file.chmod(0o600)
authorization='Basic '+base64.b64encode(('x-access-token:'+token).encode()).decode()
class PrivateGit(http.server.BaseHTTPRequestHandler):
    accepted=0
    def serve_git(self):
        if self.headers.get('Authorization') != authorization:
            self.send_response(401); self.send_header('WWW-Authenticate', 'Basic realm="fixture"'); self.end_headers(); return
        PrivateGit.accepted+=1
        url=urllib.parse.urlsplit(self.path)
        environment={**os.environ,'GIT_PROJECT_ROOT':str(exported),'GIT_HTTP_EXPORT_ALL':'1','PATH_INFO':url.path,'QUERY_STRING':url.query,'REQUEST_METHOD':self.command,'REMOTE_USER':'fixture','CONTENT_TYPE':self.headers.get('Content-Type',''),'CONTENT_LENGTH':self.headers.get('Content-Length','0')}
        body=self.rfile.read(int(environment['CONTENT_LENGTH']))
        result=subprocess.run(['git','http-backend'],input=body,capture_output=True,env=environment,timeout=20)
        assert result.returncode==0
        headers,body=result.stdout.split(b'\r\n\r\n',1)
        values=[line.decode().split(':',1) for line in headers.split(b'\r\n')]
        self.send_response(next((int(v.strip().split()[0]) for k,v in values if k.lower()=='status'),200))
        for key,value in values:
            if key.lower()!='status': self.send_header(key,value.strip())
        self.end_headers();self.wfile.write(body)
    do_GET=serve_git
    do_POST=serve_git
    def log_message(self, *_args): pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),PrivateGit)
threading.Thread(target=server.serve_forever,daemon=True).start()
configuration=root/'gitconfig'
configuration.write_text('[url "http://127.0.0.1:%s/private.git"]\n insteadOf = https://github.com/fixture/private.git\n'%server.server_port)
environment={**os.environ,'GIT_CONFIG_GLOBAL':str(configuration),'GIT_CONFIG_NOSYSTEM':'1','PROJECT':str(project),'FIXTURE':str(root)}
script='''set -euo pipefail
source "$PROJECT/deploy/wizard/core.sh"
source "$PROJECT/deploy/wizard/releases.sh"
WIZARD_ROOT=$PROJECT; APP_DIR=$FIXTURE/app
GIT_REPO=https://github.com/fixture/private.git; GIT_REF=main
GITHUB_TOKEN_FILE=$FIXTURE/token; SSH_IDENTITY_FILE=''
fetch_release
printf '%s\\n' "$RELEASE_SHA"
'''
try:
    result=subprocess.run(['bash','-c',script],env=environment,text=True,capture_output=True,timeout=45)
    assert result.returncode==0, result.stderr
    assert expected in result.stdout and PrivateGit.accepted>0
    assert token not in result.stdout+result.stderr
    assert git('--git-dir='+str(cache/'repository.git'),'show',expected+':evidence')=='independently expected private repository bytes'
    token_file.chmod(0o644)
    rejected=subprocess.run(['bash','-c',script],env=environment,text=True,capture_output=True,timeout=20)
    assert rejected.returncode!=0 and token not in rejected.stdout+rejected.stderr
    print('PASS actual private HTTP Git fetch, exact commit/content, no token leakage and unsafe-permission denial')
finally:
    server.shutdown()
