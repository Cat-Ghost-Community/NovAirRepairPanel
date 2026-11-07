"""Disposable PTY acceptance for the real terminal prompts; no host mutations."""
import errno
import os
import pty
import select
import signal
import time


def session(command, replies, required, forbidden=()):
    pid, terminal = pty.fork()
    if pid == 0:
        os.environ.update({
            "TERM": "dumb", "NO_COLOR": "1", "COLUMNS": "80",
            "REPAID_DATA_DIR": "/var/lib/repaid", "REPAID_BACKUP_DIR": "/var/backups/repaid",
            "REPAID_APP_DIR": "/opt/repaid", "DOMAIN": "", "SERVER_IP": "",
            "SSL_TYPE": "", "ADMIN_EMAIL": "",
        })
        os.execvp("bash", ["bash", "--noprofile", "--norc", "-c", command])
    transcript, cursor, reply = b"", 0, 0
    deadline, finished = time.monotonic() + 25, False
    try:
        while time.monotonic() < deadline:
            ready, _, _ = select.select([terminal], [], [], 0.1)
            if ready:
                try:
                    chunk = os.read(terminal, 65536)
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
                    break
                if not chunk:
                    break
                transcript += chunk
            while reply < len(replies):
                prompt, value = replies[reply]
                found = transcript.find(prompt.encode(), cursor)
                if found < 0:
                    break
                cursor = found + len(prompt.encode())
                os.write(terminal, value.encode() + b"\n")
                reply += 1
        else:
            raise AssertionError("Terminal interaction timed out")
        _, status = os.waitpid(pid, 0)
        finished = True
        text = transcript.decode("utf-8", errors="replace")
        assert os.waitstatus_to_exitcode(status) == 0, text[-1500:]
        assert reply == len(replies), (reply, text[-1500:])
        for value in required:
            assert value in text, (value, text[-1500:])
        for value in forbidden:
            assert value not in text, "Sensitive input was echoed"
    finally:
        os.close(terminal)
        if not finished:
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            os.waitpid(pid, 0)


session('bash setup.sh --plan', [
    ('Domain name (leave empty for IP mode)', 'not a domain'),
    ('Domain name (leave empty for IP mode)', ''),
    ('Server IPv4 address', '999.1.1.1'),
    ('Server IPv4 address', '192.0.2.20'),
    ('Settings', 'bad'),
    ('Settings', '1'),
], ['Step 1 of 3', 'Step 2 of 3', 'Step 3 of 3', 'https://192.0.2.20',
    'valid domain', 'reachable IPv4', 'Choose one of', 'No database wipe'])

session('bash setup.sh --plan', [
    ('Domain name (leave empty for IP mode)', 'repairs.example.com'),
    ('SSL notification/contact email', 'invalid'),
    ('SSL notification/contact email', 'ops@example.com'),
    ('Settings', '1'),
], ['Trusted Let\'s Encrypt', 'valid email', 'https://repairs.example.com'])

session('source ./manage.sh; NODE_BIN=$(command -v node); open_terminal; collect_owner_credentials; '
        'printf "\\nOWNER_INPUT_ACCEPTED\\n"; unset owner_password confirmation', [
    ('Company owner email', 'owner@example.com'),
    ('Owner name', 'Fixture owner'),
    ('Owner password (12-1024 characters)', 'short'),
    ('Owner password (12-1024 characters)', 'Synthetic-Long-Password-57'),
    ('Repeat password', 'Another-Synthetic-Password-58'),
    ('Owner password (12-1024 characters)', 'Synthetic-Long-Password-57'),
    ('Repeat password', 'Synthetic-Long-Password-57'),
], ['12-1024 characters', 'Passwords differ', 'OWNER_INPUT_ACCEPTED'],
    ['Synthetic-Long-Password-57', 'Another-Synthetic-Password-58'])

print('3 real PTY journeys passed: IP/domain validation, menu retry, hidden owner password retry')
