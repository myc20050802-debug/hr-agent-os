@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal

REM HR-Agent OS - local full-stack launcher (no npm dependency)
REM 用法：双击本文件；服务就绪后会自动打开 http://127.0.0.1:8788
REM 关闭服务：在 "HR-Agent OS Server" 窗口按 Ctrl+C

set "NODE_EXE=C:\Users\mayunchong\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"
set "URL=http://127.0.0.1:8788"

echo ============================================
echo   HR-Agent OS
echo   %URL%
echo ============================================
echo.

REM ---- 情况 1：端口已被监听 → 服务本来就在跑，直接开页面，不再起第二个实例 ----
netstat -ano | findstr ":8788" | findstr /c:"LISTENING" >nul
if not errorlevel 1 (
  echo [i] 服务已在运行，直接打开浏览器...
  start "" "%URL%"
  ping -n 3 127.0.0.1 >nul
  exit /b 0
)

REM ---- 情况 2：另开一个窗口跑服务（本窗口只负责等待和开浏览器） ----
echo [i] 正在启动服务...
start "HR-Agent OS Server" "%NODE_EXE%" --experimental-sqlite server.js

echo [i] 等待服务就绪...
set /a _tries=0
:wait
netstat -ano | findstr ":8788" | findstr /c:"LISTENING" >nul
if not errorlevel 1 goto ready
set /a _tries+=1
if %_tries% GEQ 25 goto failed
ping -n 2 127.0.0.1 >nul
goto wait

:ready
echo [i] 服务已就绪，打开 %URL%
start "" "%URL%"
ping -n 3 127.0.0.1 >nul
exit /b 0

:failed
echo.
echo [X] 服务在约 25 秒内没有起来。
echo     请看 "HR-Agent OS Server" 窗口里的报错，或检查 server\logs\app.log
echo     常见原因：端口 8788 被占用 / node 路径失效 / 数据库文件被锁
echo.
pause
exit /b 1
