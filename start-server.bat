@echo off
echo ========================================
echo    NEON REBOUND - Starting Server
echo ========================================
echo.
echo Server will be available at:
echo   http://localhost:8000
echo.
echo Press Ctrl+C to stop the server
echo ========================================
echo.

cd /d "%~dp0"

REM Try Node.js first
where node >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Starting Node.js HTTP server...
    npx -y http-server -p 8000
    goto :end
)

REM Try Python
where python >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Starting Python HTTP server...
    python -m http.server 8000
    goto :end
)

REM No server found
echo ERROR: Neither Node.js nor Python found!
echo Please install one of them to run the server.
echo.
echo Node.js: https://nodejs.org/
echo Python: https://www.python.org/
pause

:end

