#!/usr/bin/env bash
# ===========================================================
# tools/dev-up.sh · 确保本地后端在跑（找 node → 交给 dev-up.js）
# ---------------------------------------------------------------
# 给 WorkBuddy 项目级 SessionStart hook 调用（Windows 上 hook 走 Git Bash）。
# 只做一件事：找到可用的 Node(≥22)，转交 tools/dev-up.js 做真正的幂等启动。
#
# 两条踩过的坑，已写进实现，勿改回去：
#   ① **不用 dirname / sed / readlink / cygpath** —— 本机 bash 的 PATH 里可能
#      没有这些外部命令（已实测 dirname 会 command not found），只用 bash 内建。
#   ② **不把 POSIX 绝对路径当参数传给 node.exe** —— MSYS 下 `cd ... && pwd`
#      得到的是 `/c/Users/...`，而 node.exe 是 Windows 程序，会把它拼成
#      `C:\c\Users\...` 然后 MODULE_NOT_FOUND。正确做法：先 `cd` 进项目根，
#      再把**相对路径** tools/dev-up.js 交给 node。
#
# 永远 exit 0 —— 这是便利设施，不该让会话启动失败。
# ===========================================================
set -u

# ---- 定位项目根：优先 hook 注入的 $CODEBUDDY_PROJECT_DIR ----
DIR="${CODEBUDDY_PROJECT_DIR:-}"
DIR="${DIR//\\//}"                     # 反斜杠转斜杠（纯 bash 参数展开，不用 sed）
if [ ! -f "$DIR/tools/dev-up.js" ]; then
  SELF="${BASH_SOURCE[0]:-$0}"
  case "$SELF" in
    */*) DIR="${SELF%/*}/.." ;;
    *)   DIR="." ;;
  esac
fi
if ! cd "$DIR" 2>/dev/null; then
  echo "[X] 无法进入项目目录：$DIR"
  exit 0
fi
PWD_NOW="$(pwd)"                       # pwd 是 bash 内建，安全

if [ ! -f tools/dev-up.js ]; then
  echo "[X] 找不到 tools/dev-up.js（项目根解析为：$PWD_NOW）"
  exit 0
fi

# ---- 找 Node ≥ 22 ----
node_major() {                         # $1 = 可执行文件
  local v
  v="$("$1" -v 2>/dev/null)" || return 1
  v="${v#v}"
  echo "${v%%.*}"
}

NODE_BIN=""
if command -v node >/dev/null 2>&1; then
  maj="$(node_major node)"
  if [ -n "$maj" ] && [ "$maj" -ge 22 ] 2>/dev/null; then NODE_BIN="node"; fi
fi
if [ -z "$NODE_BIN" ]; then
  for c in \
    "$HOME/.workbuddy/binaries/node/versions/22.22.2-3/node.exe" \
    "${USERPROFILE:-}/.workbuddy/binaries/node/versions/22.22.2-3/node.exe" \
    "/c/Program Files/nodejs/node.exe" ; do
    if [ -n "$c" ] && [ -x "$c" ]; then NODE_BIN="$c"; break; fi
  done
fi

if [ -z "$NODE_BIN" ]; then
  echo "[X] 找不到 Node 22+（node:sqlite 需要）。装一个：https://nodejs.org"
  exit 0
fi

# 已 cd 到项目根 → 用相对路径，避开 MSYS 与 node.exe 的路径格式之争
exec "$NODE_BIN" tools/dev-up.js "$@"
