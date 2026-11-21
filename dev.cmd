@echo off
setlocal EnableExtensions DisableDelayedExpansion

if not exist "%~dp0voice_service\.venv\Scripts\python.exe" (
    echo [ERROR] Voice environment missing. See voice_service\README.md.
    exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm.cmd not found. Install Node.js and reopen CMD.
    exit /b 1
)

if not exist "%~dp0frontend\node_modules\.bin\next.cmd" (
    echo [ERROR] Frontend dependencies missing. Run npm ci inside frontend.
    exit /b 1
)

set "VOICE_SERVICE_PORT=3091"
set "NEXT_PUBLIC_VOICE_ENABLED=1"

start "Capstone - Voice" /D "%~dp0voice_service" "%ComSpec%" /d /k ".venv\Scripts\python.exe -m uvicorn service:app --host 127.0.0.1 --port %VOICE_SERVICE_PORT% --no-access-log"
if errorlevel 1 exit /b 1
start "Capstone - Frontend" /D "%~dp0frontend" "%ComSpec%" /d /k "npm.cmd run dev"
if errorlevel 1 exit /b 1

echo Open http://127.0.0.1:3080 when both server windows are ready.
