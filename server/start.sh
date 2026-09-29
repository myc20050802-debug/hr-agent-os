#!/usr/bin/env sh
# HR-Agent OS · 本地全栈启动（macOS / Linux，零 npm 依赖）
#
# 用法：sh server/start.sh        （或在 server/ 下 ./start.sh）
#       PORT=9000 sh server/start.sh
# 停止：Ctrl+C（脚本会把子进程一起收掉）
#
# 与 start.bat 行为对齐：已在运行则直接打开页面，否则起服务并等待就绪。

set -e
cd "$(dirname "$0")"

PORT="${PORT:-8788}"
URL="http://127.0.0.1:${PORT}"

echo "============================================"
echo "  HR-Agent OS"
echo "  ${URL}"
echo "============================================"
echo

# ---- Node 检查：需要 22+（node:sqlite 是内置模块，22.5 起可用） ----
if ! command -v node >/dev/null 2>&1; then
  echo "[X] 找不到 node。请安装 Node 22 及以上：https://nodejs.org"
  exit 1
fi
NODE_VER="$(node --version)"               # 形如 v22.22.2
NODE_MAJOR="$(printf '%s' "$NODE_VER" | sed 's/^v//' | cut -d. -f1)"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "[X] 检测到 Node ${NODE_VER}，低于 22。node:sqlite 需要 22 及以上。"
  exit 1
fi
echo "[i] Node ${NODE_VER}"

# ---- 就绪探测用 node 自身实现，不依赖 curl/wget ----
probe() {
  node -e "const u='$URL/api/health';const t=Date.now();(function p(){fetch(u).then(()=>process.exit(0)).catch(()=>{if(Date.now()-t>2000)process.exit(1);setTimeout(p,200)})})()" >/dev/null 2>&1
}

open_browser() {
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then open "$URL" >/dev/null 2>&1 || true
  fi
}

# ---- 情况 1：服务已在跑 → 直接开页面 ----
if probe; then
  echo "[i] 服务已在运行，直接打开浏览器..."
  open_browser
  exit 0
fi

# ---- 情况 2：起服务 ----
echo "[i] 正在启动服务..."
node --experimental-sqlite server.js &
PID=$!
trap 'kill "$PID" 2>/dev/null || true' INT TERM EXIT

i=0
while [ "$i" -lt 100 ]; do
  if probe; then break; fi
  i=$((i + 1))
  sleep 0.5
done

if [ "$i" -ge 100 ]; then
  echo "[X] 服务在约 50 秒内没有起来。请检查上方报错，或查看 server/logs/app.log"
  exit 1
fi

echo "[i] 服务已就绪，打开 ${URL}"
open_browser
echo "[i] 按 Ctrl+C 停止服务"
wait "$PID"
