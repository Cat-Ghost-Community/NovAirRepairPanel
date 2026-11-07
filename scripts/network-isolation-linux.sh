#!/usr/bin/env bash
set -euo pipefail
# Run only against the disposable harness. No host firewall, routing or live DB changes.
command -v unshare >/dev/null
command -v ip >/dev/null
exec unshare --net -- bash -euo pipefail -c '
  ip link set lo up
  test "$(ip -o link show | wc -l)" -eq 1
  test -z "$(ip route show default)"
  node -e '\''const net=require("node:net");const socket=net.connect({host:"203.0.113.7",port:443});socket.setTimeout(1000,()=>{socket.destroy();process.exitCode=1;});socket.on("connect",()=>{socket.destroy();process.exitCode=1;});socket.on("error",e=>{if(e.code!=="ENETUNREACH")process.exitCode=1;});'\''
  export REPAID_NETWORK_KERNEL_ISOLATED=1
  exec node scripts/network-isolation.cjs
'
