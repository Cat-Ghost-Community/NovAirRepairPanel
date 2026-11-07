#!/usr/bin/env bash
# Credentials are read privately; never embedded in the URL, arguments or source.
set -euo pipefail
set +x
case ${1:-} in
  *Username*|*username*) printf '%s\n' x-access-token;;
  *Password*|*password*)
    file=${REPAID_GITHUB_TOKEN_FILE:?Private token file required}
    [[ -f $file && ! -L $file && $(stat -c '%u' "$file") == 0 ]] || exit 1
    mode=$(stat -c '%a' "$file"); (( (8#$mode & 8#077) == 0 )) || exit 1
    IFS= read -r token < "$file" || [[ -n ${token:-} ]]
    [[ -n $token && $token != *[[:space:]]* ]] || exit 1
    printf '%s\n' "$token";;
  *) exit 1;;
esac
