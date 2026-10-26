@echo off
REM ===================================================================
REM  Nova Studio - the web UI.  Double-click this file on Windows.
REM  It opens http://127.0.0.1:8765 in your browser; close this window
REM  (or press Ctrl+C) to stop the server.
REM ===================================================================
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (set PY=py -3) else (set PY=python)

%PY% -c "import sys; sys.exit(0 if sys.version_info>=(3,8) else 1)" 2>nul
if errorlevel 1 (
    echo.
    echo   Python 3.8 or newer was not found on this computer.
    echo   Install it from https://www.python.org/downloads/ and tick
    echo   "Add python.exe to PATH" during setup.
    echo.
    pause
    exit /b 1
)

%PY% -m nova serve %*
if errorlevel 1 pause
endlocal
