#!/usr/bin/env bash
# One guarded deployment path, matching exp/deploy.sh.
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
exec bash "$ROOT/manage.sh" --smart-update "$@"
