@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal

REM HR-Agent OS - 本地全栈启动（零 npm 依赖）
REM 用法：双击本文件；服务就绪后自动打开 http://127.0.0.1:8788
REM 关闭服务：在 "HR-Agent OS Server" 窗口按 Ctrl+C

set "PORT=8788"
set "URL=http://127.0.0.1:8788"
set "NODE_EXE="
set "NODE_VER="

echo ============================================
echo   HR-Agent OS
echo   %URL%
echo ============================================
echo.

REM ---- 优先用 PATH 上的 node：换一台机器也能跑 ----
for /f "delims=" %%v in ('node --version 2^>nul') do set "NODE_VER=%%v"
if defined NODE_VER (
  for /f "tokens=1 delims=." %%a in ("%NODE_VER:v=%") do set "NODE_MAJOR=%%a"
  setlocal enabledelayedexpansion
  if !NODE_MAJOR! GEQ 22 (
    endlocal
    set "NODE_EXE=node"
  ) else (
    endlocal
    echo [!] PATH 上的 Node 是 %NODE_VER%，低于 22；node:sqlite 需要 22 及以上。
  )
)

REM ---- 退回本机固定路径（开发机上 WorkBuddy 自带的 node）----
if not defined NODE_EXE (
  if exist "%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-3\node.exe" (
    set "NODE_EXE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
  )
)

if not defined NODE_EXE (
  echo [X] 找不到可用的 Node（需要 22 及以上）。
  echo     请安装 Node 22+ 并确认 node 在 PATH 上：https://nodejs.org
  echo.
  pause
  exit /b 1
)

REM ---- 情况 1：端口已被监听 → 服务本来就在跑，直接开页面，不再起第二个实例 ----
netstat -ano | findstr ":%PORT%" | findstr /c:"LISTENING" >nul
if not errorlevel 1 (
  echo [i] 服务已在运行，直接打开浏览器...
  start "" "%URL%"
  ping -n 3 127.0.0.1 >nul
  exit /b 0
)

REM ---- 情况 2：另开一个窗口跑服务（本窗口只负责等待和开浏览器） ----
echo [i] 正在启动服务（%NODE_EXE%）...
start "HR-Agent OS Server" "%NODE_EXE%" --experimental-sqlite server.js

echo [i] 等待服务就绪...
set /a _tries=0
:wait
netstat -ano | findstr ":%PORT%" | findstr /c:"LISTENING" >nul
if not errorlevel 1 goto ready
set /a _tries+=1
if %_tries% GEQ 40 goto failed
ping -n 2 127.0.0.1 >nul
goto wait

:ready
echo [i] 服务已就绪，打开 %URL%
start "" "%URL%"
ping -n 3 127.0.0.1 >nul
exit /b 0

:failed
echo.
echo [X] 服务在约 40 秒内没有起来。
echo     请看 "HR-Agent OS Server" 窗口里的报错，或检查 server\logs\app.log
echo     常见原因：端口 %PORT% 被占用 / node 版本低于 22 / 数据库文件被锁
echo.
pause
exit /b 1
