@echo off
setlocal

set ROOT=C:\Users\Rao Talha\Downloads\itb-main\itb-main

echo Starting backend...
start "ITB Backend" cmd /k "cd /d %ROOT%\backend && npm start"

echo Starting frontend...
start "ITB Frontend" cmd /k "cd /d %ROOT% && npx ng serve --build-target itb:build:development --open"

echo.
echo Backend: http://localhost:3000
echo Frontend: check opened browser URL (4200 or next available)
echo.
echo Tip: run Phase 3/4 API verification with:
echo powershell -ExecutionPolicy Bypass -File "%ROOT%\scripts\phase34-api-verify.ps1"

endlocal
