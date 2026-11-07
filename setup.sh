#!/usr/bin/env bash
# One-command bootstrap, adapted from the user's exp/setup.sh.
set -euo pipefail
set +x
umask 077
if [[ -n ${BASH_SOURCE[0]:-} && -f ${BASH_SOURCE[0]} ]]; then
  ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
  trusted=1
  if [[ $EUID == 0 ]]; then
    parent=$ROOT
    while true; do
      mode=$(stat -c '%a' "$parent")
      if [[ $(stat -c '%u' "$parent") != 0 ]] || (( (8#$mode & 8#022) != 0 )); then trusted=0; break; fi
      [[ $parent != / ]] || break; parent=$(dirname -- "$parent")
    done
  fi
  if [[ $trusted == 1 && -f $ROOT/deploy/wizard/core.sh && ! -L $ROOT/deploy && ! -L $ROOT/deploy/wizard ]]; then exec bash "$ROOT/manage.sh" --install-wizard "$@"; fi
fi
REF=${REPAID_REF:-main}
REPO=${REPAID_REPO:-git@github.com:Cat-Ghost-Community/NovAirRepairPanel.git}
ARGS=("$@")
while (($#)); do
  case $1 in --help|-h) printf '%s\n' 'Repaid bootstrap: sudo bash setup.sh [--ref BRANCH_OR_SHA] [--repo GITHUB_URL] [--yes]' 'Private GitHub access requires a server deploy key and verified known_hosts. Prefer saving/reviewing this file before sudo.'; exit;;
    --plan) printf 'Bootstrap plan: fetch %s at %s into a private temporary directory, then launch its installer. No host changes applied.\n' "$REPO" "$REF"; exit;;
    --ref) REF=${2:?Release required}; shift;; --repo) REPO=${2:?Repository required}; shift;; --yes) ;; *) printf 'Unknown option: %s\n' "$1" >&2; exit 1;; esac; shift
done
[[ $EUID == 0 && $(uname -s) == Linux ]] || { echo 'Use sudo on Ubuntu/Debian.' >&2; exit 1; }
[[ $REPO =~ ^git@github\.com:[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\.git$ || $REPO =~ ^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\.git$ ]] || { echo 'Unsupported repository URL' >&2; exit 1; }
[[ $REF =~ ^[A-Za-z0-9][A-Za-z0-9_./-]*$ && $REF != *..* ]] || { echo 'Invalid release reference' >&2; exit 1; }
export PATH=/usr/sbin:/usr/bin:/sbin:/bin GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND='ssh -o BatchMode=yes -o StrictHostKeyChecking=yes'
unset GIT_TRACE GIT_TRACE_PACKET GIT_TRACE_CURL GIT_CURL_VERBOSE GIT_TRACE2 GIT_TRACE2_EVENT GIT_TRACE2_PERF
if [[ -n ${REPAID_SSH_IDENTITY_FILE:-} ]]; then
  file=$REPAID_SSH_IDENTITY_FILE
  [[ $file =~ ^/[A-Za-z0-9_./-]+$ && $file != *..* && $REPO == git@github.com:* && -f $file && ! -L $file && $(stat -c '%u' "$file") == 0 ]] || { echo 'Use an ordinary root-owned SSH identity and the SSH repository URL.' >&2; exit 1; }
  mode=$(stat -c '%a' "$file"); (( (8#$mode & 8#077) == 0 )) || exit 1
  export GIT_SSH_COMMAND="ssh -i $file -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes"
fi
if ! command -v git >/dev/null; then apt-get update; DEBIAN_FRONTEND=noninteractive apt-get install -y git ca-certificates; fi
TEMPORARY=$(mktemp -d /var/tmp/repaid-bootstrap.XXXXXX)
if [[ -n ${REPAID_GITHUB_TOKEN_FILE:-} ]]; then
  file=$REPAID_GITHUB_TOKEN_FILE
  [[ $REPO == https://github.com/* && -f $file && ! -L $file && $(stat -c '%u' "$file") == 0 ]] || { echo 'Use a root-only token file with the HTTPS repository URL.' >&2; exit 1; }
  mode=$(stat -c '%a' "$file"); (( (8#$mode & 8#077) == 0 )) || { echo 'Token file must be chmod 600.' >&2; exit 1; }
  cat > "$TEMPORARY/askpass" <<'ASKPASS'
#!/usr/bin/env bash
set -euo pipefail
set +x
case ${1:-} in *Username*|*username*) echo x-access-token;; *Password*|*password*) IFS= read -r token < "$REPAID_GITHUB_TOKEN_FILE" || [[ -n ${token:-} ]]; [[ -n $token && $token != *[[:space:]]* ]] || exit 1; printf '%s\n' "$token";; *) exit 1;; esac
ASKPASS
  chmod 0700 "$TEMPORARY/askpass"
  export GIT_ASKPASS="$TEMPORARY/askpass"
fi
git init "$TEMPORARY/source" >/dev/null
git -c credential.helper= -C "$TEMPORARY/source" fetch --depth=1 "$REPO" "$REF"
SHA=$(git -C "$TEMPORARY/source" rev-parse FETCH_HEAD)
[[ $SHA =~ ^[0-9a-f]{40}$ ]] || exit 1
git -C "$TEMPORARY/source" checkout --detach "$SHA" >/dev/null
[[ -f $TEMPORARY/source/manage.sh && -f $TEMPORARY/source/deploy/wizard/core.sh ]] || { echo 'Selected release has no compatible installer' >&2; exit 1; }
exec bash "$TEMPORARY/source/manage.sh" --install-wizard "${ARGS[@]}" --ref "$SHA"
