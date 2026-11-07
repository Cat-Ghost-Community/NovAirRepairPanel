#!/usr/bin/env bash
# Adapted from the user's exp/{setup,install,manage}.sh: terminal helpers,
# private root configuration, exact confirmations and collision-aware ports.
set +x
WIZARD_VERSION=1.3.0
CONFIG_FILE=/etc/repaid/server.conf
APP_ENV=/etc/repaid/repaid.env
BACKUP_ENV=/etc/repaid/backup.env
MAINTENANCE_FILE=/etc/repaid/maintenance
SERVICE=repaid
BUILD_USER=repaid-build
NODE_BIN=/usr/bin/node
GIT_REPO_DEFAULT=git@github.com:Cat-Ghost-Community/NovAirRepairPanel.git
GIT_REF_DEFAULT=main
GITHUB_TOKEN_FILE=${REPAID_GITHUB_TOKEN_FILE:-}
SSH_IDENTITY_FILE=${REPAID_SSH_IDENTITY_FILE:-}
R=''; G=''; Y=''; C=''; P=''; W=''; DIM=''; NC=''; BOLD=''
if [[ -t 1 && ${TERM:-dumb} != dumb && -z ${NO_COLOR:-} ]]; then
  R=$'\033[0;31m'; G=$'\033[0;32m'; Y=$'\033[1;33m'; C=$'\033[0;36m'
  P=$'\033[0;35m'; W=$'\033[1;37m'; DIM=$'\033[2m'; NC=$'\033[0m'; BOLD=$'\033[1m'
fi
info() { printf '%s  ✔ %s%s\n' "$G" "$NC" "$*"; }
warn() { printf '%s  ! %s%s\n' "$Y" "$NC" "$*" >&2; }
fail() { printf '%s  ✘ %s%s\n' "$R" "$NC" "$*" >&2; return 1; }
step() { printf '\n%s  ▶ %s%s\n' "$C" "$BOLD" "$*"; printf '%s' "$NC"; }
terminal_width() { local width=${COLUMNS:-}; if [[ -z $width && -t 1 ]] && command -v tput >/dev/null; then width=$(tput cols 2>/dev/null) || width=80; fi; [[ $width =~ ^[0-9]{1,3}$ ]] || width=80; width=$((10#$width)); ((width>=16)) || width=16; printf '%s' "$width"; }
terminal_height() { local height=${LINES:-}; if [[ -z $height && -t 1 ]] && command -v tput >/dev/null; then height=$(tput lines 2>/dev/null) || height=40; fi; [[ $height =~ ^[0-9]{1,3}$ ]] || height=40; printf '%s' "$((10#$height))"; }
divider() { local width; width=$(terminal_width); ((width>66)) && width=66; printf '%s  ' "$DIM"; printf '%*s' "$((width-4))" '' | tr ' ' '-'; printf '%s\n' "$NC"; }
show_banner() {
  [[ -t 1 && ${TERM:-dumb} != dumb ]] && clear || true
  printf '\n%s' "$P"
  if (($(terminal_width)>=70 && $(terminal_height)>=38)); then
    # Framing, large wordmark and purple/white hierarchy follow exp/manage.sh.
    printf '%s\n' '  ╔══════════════════════════════════════════════════════════════╗'
    local line
    while IFS= read -r line; do printf '  ║%s%*s║\n' "$line" "$((62-${#line}))" ''; done <<'WORDMARK'

       ██████╗ ███████╗██████╗  █████╗ ██╗██████╗
       ██╔══██╗██╔════╝██╔══██╗██╔══██╗██║██╔══██╗
       ██████╔╝█████╗  ██████╔╝███████║██║██║  ██║
       ██╔══██╗██╔══╝  ██╔═══╝ ██╔══██║██║██║  ██║
       ██║  ██║███████╗██║     ██║  ██║██║██████╔╝
       ╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝  ╚═╝╚═╝╚═════╝

WORDMARK
    printf '%s\n' '  ╚══════════════════════════════════════════════════════════════╝'
  else printf '  REPAID\n'; divider; fi
  printf '%s  %s%s  v%s%s\n' "$W" "$BOLD" "${1:-Management Panel}" "$WIZARD_VERSION" "$NC"
  printf '  %sOne Command · Setup & Management%s\n\n' "$DIM" "$NC"
}
wizard_step() { printf '\n  %s%sStep %s of %s - %s%s\n' "$W" "$BOLD" "$1" "$2" "$3" "$NC"; divider; }
progress_step() { printf '\n  %s[%s/%s]%s %s\n' "$C" "$1" "$2" "$NC" "$3"; }
menu_item() { printf '  %s%2s.%s %s\n' "$C" "$1" "$NC" "$2"; [[ -z ${3:-} || ${COMPACT_MENU:-0} == 1 ]] || printf '      %s%s%s\n' "$DIM" "$3" "$NC"; return 0; }
pause_screen() { [[ ${HAS_TTY:-0} == 1 ]] || return 0; printf '\n  Press Enter to return...' >&3; IFS= read -r -u 3; }
open_terminal() { if { exec 3<>/dev/tty; } 2>/dev/null; then HAS_TTY=1; else HAS_TTY=0; fi; }
ask() {
  local prompt=$1 default=${2:-} value
  [[ ${HAS_TTY:-0} == 1 ]] || { printf '%s' "$default"; return; }
  printf '  %s?%s %s' "$C" "$NC" "$prompt" >&3
  [[ -z $default ]] || printf ' %s[%s]%s' "$DIM" "$default" "$NC" >&3
  printf ': ' >&3
  IFS= read -r -u 3 value || return 1; printf '%s' "${value:-$default}"
}
ask_validated() {
  local value prompt=$1 default=$2 validator=$3 hint=$4
  while true; do
    value=$(ask "$prompt" "$default") || return 130
    [[ $value != q && $value != Q ]] || { warn 'Cancelled; saved data and keys are unchanged.'; return 130; }
    if "$validator" "$value"; then printf '%s' "$value"; return 0; fi
    warn "$hint"
    [[ ${HAS_TTY:-0} == 1 ]] || return 1
  done
}
ask_choice() {
  local value prompt=$1 default=$2 allowed=$3
  while true; do
    value=$(ask "$prompt" "$default") || return 130
    [[ $value != q && $value != Q ]] || value=0
    case " $allowed " in *" $value "*) printf '%s' "$value"; return 0;; esac
    warn "Choose one of: $allowed"
    [[ ${HAS_TTY:-0} == 1 ]] || return 1
  done
}
ask_secret() {
  local value; [[ ${HAS_TTY:-0} == 1 ]] || return 1
  IFS= read -r -s -u 3 -p "  ? $1: " value || return 1
  printf '\n' >&3; printf '%s' "$value"
}
confirm_exact() {
  local value; [[ ${ASSUME_YES:-0} == 1 ]] && return 0
  [[ ${HAS_TTY:-0} == 1 ]] || { fail "Interactive confirmation required, or supply --yes explicitly."; return 1; }
  printf '  Type %s to %s: ' "$1" "$2" >&3; IFS= read -r -u 3 value || return 1
  [[ $value == "$1" ]] || { warn 'Cancelled; no operation applied.'; return 1; }
}
require_root() { [[ $EUID == 0 ]] || { fail 'Run this operation with sudo.'; return 1; }; }
require_linux() {
  [[ $(uname -s) == Linux && -r /etc/os-release ]] || { fail 'Ubuntu/Debian with systemd is required.'; return 1; }
  local ID VERSION_ID; . /etc/os-release
  case "$ID:$VERSION_ID" in ubuntu:22.04|ubuntu:24.04|debian:12|debian:13) ;; *) fail "Unsupported target: $ID $VERSION_ID"; return 1;; esac
  command -v systemctl >/dev/null || { fail 'A real systemd host is required; not a plain container.'; return 1; }
}
valid_path() {
  [[ $1 =~ ^/[a-zA-Z0-9_./-]+$ && $1 != / && $1 != */ && $1 != *//* && $1 != */../* && $1 != */.. && $1 != */./* && $1 != */. ]]
}
valid_domain() {
  local label; [[ ${#1} -le 253 && $1 == *.* && $1 =~ ^[a-zA-Z0-9.-]+$ ]] || return 1
  local -a labels; IFS=. read -r -a labels <<< "$1"
  [[ $1 != *. ]] || return 1
  for label in "${labels[@]}"; do [[ ${#label} -ge 1 && ${#label} -le 63 && $label =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$ ]] || return 1; done
}
valid_ip() {
  local n; local -a parts; [[ $1 =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1
  IFS=. read -r -a parts <<< "$1"; for n in "${parts[@]}"; do [[ ${#n} -le 3 && ( $n == 0 || $n != 0* ) ]] && ((10#$n <= 255)) || return 1; done
}
valid_port() { [[ $1 =~ ^[0-9]{4,5}$ && $1 != 0* ]] && ((10#$1 >= 1024 && 10#$1 <= 65535)); }
valid_email() { [[ ${#1} -le 254 && $1 =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; }
valid_app_path() { valid_path "$1" && [[ $1 == /opt/* || $1 == /srv/* || $1 == /var/www/* ]]; }
valid_owner_name() { [[ -n $1 && ${#1} -le 120 ]]; }
valid_repo() { [[ $1 =~ ^git@github\.com:[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\.git$ || $1 =~ ^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\.git$ ]]; }
valid_ref() { [[ $1 =~ ^[0-9a-f]{40}$ ]] || { [[ $1 != -* && $1 != *..* && $1 != *@* && $1 =~ ^[A-Za-z0-9][A-Za-z0-9_./-]*$ ]] && git check-ref-format --branch "$1" >/dev/null 2>&1; }; }
validate_config() {
  valid_path "$APP_DIR" && valid_path "$DATA_DIR" && valid_path "$BACKUP_DIR" || { fail 'Use absolute ordinary paths without whitespace or traversal.'; return 1; }
  [[ $APP_DIR == /opt/* || $APP_DIR == /var/www/* || $APP_DIR == /srv/* ]] || { fail 'APP_DIR must be a dedicated subdirectory of /opt, /srv or /var/www.'; return 1; }
  [[ $DATA_DIR != "$APP_DIR" && $DATA_DIR != "$APP_DIR/"* && $BACKUP_DIR != "$APP_DIR" && $BACKUP_DIR != "$APP_DIR/"* && $APP_DIR != "$DATA_DIR/"* ]] || { fail 'Data/backups must be outside the release tree.'; return 1; }
  valid_repo "$GIT_REPO" && valid_ref "$GIT_REF" && valid_port "$APP_PORT" || { fail 'Invalid repository, release reference or port.'; return 1; }
  if [[ $SSL_TYPE == domain ]]; then valid_domain "$DOMAIN" && [[ $CONTACT_EMAIL =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || { fail 'Valid domain and certificate contact email required.'; return 1; }
  elif [[ $SSL_TYPE == ip ]]; then valid_ip "$SERVER_IP" || { fail 'A valid IPv4 address is required.'; return 1; }
  else fail 'Choose domain or ip TLS mode.'; return 1; fi
}
_config_write_line() {
  local file=$1 key=$2 value=$3
  [[ $key =~ ^[A-Za-z_][A-Za-z0-9_]*$ && $value != *$'\n'* && $value != *$'\r'* ]] || return 1
  printf '%s=%q\n' "$key" "$value" >> "$file"
}
assert_root_file() {
  local mode; [[ -f $1 && ! -L $1 && $(stat -c '%u' "$1") == 0 ]] || { fail 'Configuration must be an ordinary root-owned file.'; return 1; }
  mode=$(stat -c '%a' "$1"); (( (8#$mode & 8#022) == 0 )) || { fail 'Refusing group/world-writable configuration.'; return 1; }
}
assert_secret_file() {
  assert_root_file "$1" || return 1
  local mode; mode=$(stat -c '%a' "$1"); (( (8#$mode & 8#077) == 0 )) || { fail 'Private credential input must be root-only (chmod 600).'; return 1; }
}
load_config() {
  [[ ! -e /etc/repaid/address-pending || ${ADDRESS_RECOVERY_ALLOWED:-0} == 1 ]] || { fail 'Interrupted address change: run sudo repaid --address-recover before another operation.'; return 1; }
  [[ ! -e /etc/repaid/reinstall.json || ${REINSTALL_RECOVERY_ALLOWED:-0} == 1 ]] || { fail 'Interrupted clean reinstall: run sudo repaid --reinstall-recover; no other mutation is allowed.'; return 1; }
  [[ -f $CONFIG_FILE ]] || { fail 'Not installed. Run setup.sh first.'; return 1; }
  assert_root_file "$CONFIG_FILE" || return 1
  # shellcheck source=/dev/null
  . "$CONFIG_FILE"
  validate_config
}
save_config() {
  local tmp key; install -d -o root -g root -m 0755 /etc/repaid
  [[ ! -L $CONFIG_FILE ]] || return 1; tmp=$(mktemp "${CONFIG_FILE}.XXXXXX") || return 1; chmod 600 "$tmp"
  for key in APP_DIR DATA_DIR BACKUP_DIR DOMAIN SERVER_IP SSL_TYPE CONTACT_EMAIL GIT_REPO GIT_REF APP_PORT NODE_BIN INSTALL_STATE PREVIOUS_RELEASE PREVIOUS_SCHEMA GITHUB_TOKEN_FILE SSH_IDENTITY_FILE; do
    _config_write_line "$tmp" "$key" "${!key:-}" || { rm -f -- "$tmp"; return 1; }
  done
  mv -f -- "$tmp" "$CONFIG_FILE"
}
site_host() { if [[ $SSL_TYPE == domain ]]; then printf '%s' "$DOMAIN"; else printf '%s' "$SERVER_IP"; fi; }
origin() { printf 'https://%s' "$(site_host)"; }
site_lock() {
  if [[ -e /proc/$$/fd/9 && $(readlink /proc/$$/fd/9) == /run/repaid-wizard/operation.lock ]]; then flock -n 9; return $?; fi
  [[ ! -L /run/repaid-wizard ]] || return 1; install -d -o root -g root -m 0700 /run/repaid-wizard || return 1
  [[ ! -L /run/repaid-wizard/operation.lock ]] || return 1; exec 9>>/run/repaid-wizard/operation.lock || return 1
  flock -n 9 || { fail 'Another Repaid operation is running.'; return 1; }
}
_other_site_reserves_port() {
  local directory code
  for directory in /etc/nginx/sites-enabled /etc/nginx/conf.d; do
    [[ -d $directory ]] || continue
    if grep -R -Eq --exclude=repaid "(127\\.0\\.0\\.1|localhost):${1}([^0-9]|$)" "$directory" 2>/dev/null; then return 0; else code=$?; fi
    [[ $code == 1 ]] || return 2
  done
  return 1
}
select_app_port() {
  local port listener reserved
  for port in "$APP_PORT" {3000..3099}; do
    listener=$(ss -H -ltn "sport = :$port") || return 1
    if _other_site_reserves_port "$port"; then reserved=0; else reserved=$?; fi
    [[ $reserved -le 1 ]] || return 1
    if [[ $reserved == 1 ]] && { [[ -z $listener ]] || app_owns_port "$port"; }; then printf '%s' "$port"; return 0; fi
  done
  fail 'No unreserved application port available.'
}
app_owns_port() {
  local pid listener cwd; pid=$(systemctl show "$SERVICE" --property=MainPID --value 2>/dev/null) || return 1
  [[ $pid =~ ^[1-9][0-9]*$ ]] || return 1; listener=$(ss -H -ltnp "sport = :$1") || return 1
  [[ $listener == *"pid=$pid,"* ]] || return 1; cwd=$(readlink -f "/proc/$pid/cwd") || return 1
  [[ $(dirname "$cwd") == "$APP_DIR/releases" && $(basename "$cwd") =~ ^[0-9a-f]{40}-[0-9a-f]{12}$ ]]
}
run_app() {
  local release=$1 tool=$2; shift 2
  (cd "$release" && runuser -u "$SERVICE" -- env -i PATH=/usr/bin:/bin HOME="$DATA_DIR" USER="$SERVICE" LANG=C.UTF-8 \
    "$NODE_BIN" --env-file="$APP_ENV" --env-file="$BACKUP_ENV" "$release/.database-tools/$tool.cjs" "$@")
}
assert_release() {
  local release; [[ ! -L $1 && -d $1 ]] || return 1; release=$(readlink -f "$1")
  [[ $(dirname "$release") == "$APP_DIR/releases" && $(basename "$release") =~ ^[0-9a-f]{40}-[0-9a-f]{12}$ && -f $release/RELEASE_SHA && -f $release/.next/BUILD_ID && -f $release/.database-tools/deployment.cjs && $(cat "$release/RELEASE_SHA") == "$(basename "$release" | cut -c1-40)" ]] || { fail 'Unidentified or incomplete managed release.'; return 1; }
}
activate_link() {
  local release=$1 temp="$APP_DIR/.current-$$"; assert_release "$release" || return 1
  [[ ! -e $APP_DIR/current || -L $APP_DIR/current ]] || { fail 'Refusing to replace a real current directory.'; return 1; }
  [[ ! -e $temp && ! -L $temp ]] || return 1
  ln -s -- "$release" "$temp" && mv -Tf -- "$temp" "$APP_DIR/current"
}
backend_health() {
  local pid listener attempt response
  for attempt in {1..45}; do
    pid=$(systemctl show "$SERVICE" --property=MainPID --value) || return 1
    listener=$(ss -H -ltnp "sport = :$APP_PORT") || return 1
    if [[ $pid =~ ^[1-9][0-9]*$ && $listener == *"pid=$pid,"* ]]; then
      response=$(curl -fsS --max-time 5 -w $'\n%{http_code}' "http://127.0.0.1:$APP_PORT/api/health") || response=''
      if printf '%s' "$response" | "$NODE_BIN" -e 'const s=require("fs").readFileSync(0,"utf8"),i=s.lastIndexOf("\n");try{const v=JSON.parse(s.slice(0,i));process.exit(s.slice(i+1)==="200"&&v.status==="ok"&&v.database==="ok"?0:1)}catch{process.exit(1)}' 2>/dev/null; then return 0; fi
    fi
    sleep 1
  done
  fail 'The owned backend did not become healthy. Public maintenance remains enabled.'
}
