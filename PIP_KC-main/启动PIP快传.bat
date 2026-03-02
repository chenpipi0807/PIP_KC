@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
set "APPDIR=%ROOT%BASE\pip_kuaichuan_desktop"
set "PORT=9999"

REM Double-click friendly: re-launch in a persistent console window
REM NOTE: Correct quoting for cmd /k is critical.
if /I not "%~1"=="__run" (
  start "PIP KuaiChuan Launcher" cmd /k ""%~f0" __run"
  exit /b
)

if not exist "%APPDIR%\package.json" (
  echo [ERROR] Cannot find "%APPDIR%\package.json"
  echo Please double-click this file from the project root folder.
  pause
  exit /b 1
)

pushd "%APPDIR%" >nul

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm not found. Please install Node.js first.
  popd >nul
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo First run detected. Installing dependencies (npm install)...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed. Please check network/permissions/disk space.
    popd >nul
    pause
    exit /b 1
  )
)

set "MODE=%~1"
if /I "%MODE%"=="web" goto START_WEB
if /I "%MODE%"=="desktop" goto START_DESKTOP

echo.
choice /C 12 /N /M "Select mode: [1] Desktop UI  [2] Web share server"
if errorlevel 2 goto START_WEB
goto START_DESKTOP

:START_WEB
  echo.
  echo Starting web share server (press Ctrl+C to stop)...
  echo Opening browser at http://127.0.0.1:%PORT% ...
  start "" "http://127.0.0.1:%PORT%"
  call npm start
  goto AFTER_RUN

:START_DESKTOP
  echo.
  echo Starting desktop app...
  call npm run start:desktop
  goto AFTER_RUN

:AFTER_RUN
set "EXITCODE=%errorlevel%"
popd >nul

if not "%EXITCODE%"=="0" (
  echo.
  echo [ERROR] Exit code: %EXITCODE%
  pause
)

exit /b %EXITCODE%

