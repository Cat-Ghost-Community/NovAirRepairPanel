"""Exercise the downloaded bootstrap with real HTTP Git and a real terminal.

The fetched installer records its handoff; full installation is covered separately
by wizard-linux-acceptance.sh. All credentials and repositories here are fixtures.
"""
import base64
import http.server
import json
import os
import pathlib
import pty
import select
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.parse

assert os.name == 'posix' and os.getuid() == 0
assert os.environ.get('REPAID_WIZARD_ACCEPTANCE') == '1'
project = pathlib.Path.cwd()
root = pathlib.Path(tempfile.mkdtemp(prefix='novair-bootstrap-test-'))
source = root / 'source'
source.mkdir()
token = 'bootstrap-fixture-secret-only'
authorization = 'Basic ' + base64.b64encode(('x-access-token:' + token).encode()).decode()

def git(*args):
    return subprocess.check_output(['git', *map(str, args)], text=True, stderr=subprocess.DEVNULL).strip()

git('init', '-b', 'main', source)
git('-C', source, 'config', 'user.name', 'Bootstrap fixture')
git('-C', source, 'config', 'user.email', 'fixture@example.invalid')
(source / 'deploy/wizard').mkdir(parents=True)
(source / 'deploy/wizard/core.sh').write_text('# Fixture handoff boundary\n')
(source / 'manage.sh').write_text('''#!/usr/bin/env bash
set -euo pipefail
python3 - "$@" <<'PY'
import json,os,pathlib,sys
pathlib.Path(os.environ['HANDOFF']).write_text(json.dumps(dict(args=sys.argv[1:],repo=os.environ['REPAID_REPO'],token_file=os.environ.get('REPAID_GITHUB_TOKEN_FILE'))))
PY
''')
git('-C', source, 'add', '.')
git('-C', source, 'commit', '-m', 'fixture')
expected = git('-C', source, 'rev-parse', 'HEAD')
git('clone', '--bare', source, root / 'private.git')

class PrivateGit(http.server.BaseHTTPRequestHandler):
    public = False

    def serve_git(self):
        if not self.public and self.headers.get('Authorization') != authorization:
            self.send_response(401)
            self.send_header('WWW-Authenticate', 'Basic realm="fixture"')
            self.end_headers()
            return
        url = urllib.parse.urlsplit(self.path)
        environment = {**os.environ, 'GIT_PROJECT_ROOT': str(root), 'GIT_HTTP_EXPORT_ALL': '1',
                       'PATH_INFO': url.path, 'QUERY_STRING': url.query, 'REQUEST_METHOD': self.command,
                       'REMOTE_USER': 'fixture', 'CONTENT_TYPE': self.headers.get('Content-Type', ''),
                       'CONTENT_LENGTH': self.headers.get('Content-Length', '0')}
        body = self.rfile.read(int(environment['CONTENT_LENGTH']))
        result = subprocess.run(['git', 'http-backend'], input=body, capture_output=True, env=environment, timeout=20)
        assert result.returncode == 0
        headers, body = result.stdout.split(b'\r\n\r\n', 1)
        values = [line.decode().split(':', 1) for line in headers.split(b'\r\n')]
        self.send_response(next((int(v.strip().split()[0]) for k, v in values if k.lower() == 'status'), 200))
        for key, value in values:
            if key.lower() != 'status':
                self.send_header(key, value.strip())
        self.end_headers()
        self.wfile.write(body)

    do_GET = serve_git
    do_POST = serve_git

    def log_message(self, *_args):
        pass

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), PrivateGit)
threading.Thread(target=server.serve_forever, daemon=True).start()
config = root / 'gitconfig'
config.write_text('[url "http://127.0.0.1:%s/private.git"]\n insteadOf = https://github.com/Cat-Ghost-Community/NovAirRepairPanel.git\n' % server.server_port)
download = root / 'setup.sh'
shutil.copyfile(project / 'setup.sh', download)
handoff = root / 'handoff.json'
environment = {**os.environ, 'GIT_CONFIG_GLOBAL': str(config), 'GIT_CONFIG_NOSYSTEM': '1', 'HANDOFF': str(handoff)}
for key in ['REPAID_REPO', 'REPAID_REF', 'REPAID_GITHUB_TOKEN_FILE', 'REPAID_SSH_IDENTITY_FILE', 'GIT_ASKPASS']:
    environment.pop(key, None)
before_tokens = set(pathlib.Path('/root').glob('repaid-github-token.*'))
before_temporary = set(pathlib.Path('/var/tmp').glob('repaid-bootstrap.*'))

def terminal(answer):
    pid, descriptor = pty.fork()
    if pid == 0:
        os.execve('/bin/bash', ['bash', str(download)], environment)
    output, sent = b'', False
    deadline = time.monotonic() + 45
    try:
        while time.monotonic() < deadline:
            if select.select([descriptor], [], [], 0.2)[0]:
                try:
                    block = os.read(descriptor, 65536)
                except OSError:
                    break
                if not block:
                    break
                output += block
                if b'GitHub token: ' in output and not sent:
                    os.write(descriptor, (answer + '\n').encode())
                    sent = True
        else:
            os.kill(pid, 9)
            raise AssertionError('Bootstrap terminal timed out')
    finally:
        os.close(descriptor)
        _, status = os.waitpid(pid, 0)
    assert sent, output.decode(errors='replace')
    return os.waitstatus_to_exitcode(status), output.decode(errors='replace')

try:
    unattended = subprocess.run(['bash', str(download)], env=environment, text=True, capture_output=True, timeout=30)
    assert unattended.returncode != 0 and 'REPAID_GITHUB_TOKEN_FILE' in unattended.stderr
    assert not handoff.exists()
    for answer in ['q', 'wrong-fixture-token']:
        status, output = terminal(answer)
        assert status != 0 and not handoff.exists()
        assert answer == 'q' or answer not in output
        assert set(pathlib.Path('/root').glob('repaid-github-token.*')) == before_tokens
        assert set(pathlib.Path('/var/tmp').glob('repaid-bootstrap.*')) == before_temporary
    status, output = terminal(token)
    assert status == 0 and token not in output, output
    record = json.loads(handoff.read_text())
    assert record['repo'] == 'https://github.com/Cat-Ghost-Community/NovAirRepairPanel.git'
    assert record['args'] == ['--install-wizard', '--ref', expected]
    saved = pathlib.Path(record['token_file'])
    assert saved.parent == pathlib.Path('/root') and saved.name.startswith('repaid-github-token.')
    assert saved.stat().st_uid == 0 and saved.stat().st_mode & 0o777 == 0o600
    assert saved.read_text() == token + '\n'
    handoff.unlink()
    reuse = subprocess.run(['bash', str(download)], env={**environment, 'REPAID_GITHUB_TOKEN_FILE': str(saved)}, text=True, capture_output=True, timeout=30)
    assert reuse.returncode == 0 and token not in reuse.stdout + reuse.stderr
    assert json.loads(handoff.read_text())['token_file'] == str(saved)
    saved.chmod(0o644)
    handoff.unlink()
    rejected = subprocess.run(['bash', str(download)], env={**environment, 'REPAID_GITHUB_TOKEN_FILE': str(saved)}, text=True, capture_output=True, timeout=30)
    assert rejected.returncode != 0 and not handoff.exists()
    saved.unlink()
    PrivateGit.public = True
    public = subprocess.run(['bash', str(download)], env=environment, text=True, capture_output=True, timeout=30)
    assert public.returncode == 0
    assert json.loads(handoff.read_text())['token_file'] is None
    print('PASS downloaded bootstrap: private hidden prompt, exact handoff, stored-token reuse, public fetch, cancellation, invalid token, no-TTY denial, permission guards and secret cleanup')
finally:
    server.shutdown()
    for file in set(pathlib.Path('/root').glob('repaid-github-token.*')) - before_tokens:
        file.unlink()
    for directory in set(pathlib.Path('/var/tmp').glob('repaid-bootstrap.*')) - before_temporary:
        assert directory.parent == pathlib.Path('/var/tmp') and directory.name.startswith('repaid-bootstrap.')
        shutil.rmtree(directory)
    shutil.rmtree(root)
