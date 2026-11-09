@echo off
REM ============================================================================
REM  OpenWidgets - Demo-Inhalte in eine LAUFENDE Test-Instanz laden
REM
REM  Zuerst start-openwidgets.bat starten, dann dieses Skript doppelklicken
REM  oder in einem zweiten Fenster ausfuehren.
REM ============================================================================
setlocal EnableExtensions
chcp 65001 >nul
title OpenWidgets - Demo-Inhalte laden
cd /d "%~dp0"

if not defined PORT set "PORT=3000"

call :find_node
if errorlevel 1 goto :node_missing

echo.
echo ==============================================================
echo   Demo-Inhalte laden (Server muss laufen: start-openwidgets.bat)
echo ==============================================================
if not defined ADMIN_EMAIL set /p "ADMIN_EMAIL=Admin-E-Mail: "
if not defined ADMIN_PASSWORD set /p "ADMIN_PASSWORD=Admin-Passwort: "
if not defined ADMIN_EMAIL goto :missing_credentials
if not defined ADMIN_PASSWORD goto :missing_credentials

echo.
"%NODE_EXE%" scripts\seed-demo.mjs --base-url "http://localhost:%PORT%" --email "%ADMIN_EMAIL%" --password "%ADMIN_PASSWORD%"
echo.
pause
goto :eof

:missing_credentials
echo.
echo FEHLER: E-Mail und Passwort werden benoetigt.
echo.
pause
exit /b 1

:find_node
set "NODE_EXE="
where node >nul 2>nul
if not errorlevel 1 set "NODE_EXE=node"
if defined NODE_EXE exit /b 0
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if defined NODE_EXE exit /b 0
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if defined NODE_EXE exit /b 0
if exist "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" set "NODE_EXE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if defined NODE_EXE exit /b 0
exit /b 1

:node_missing
echo.
echo FEHLER: Node.js wurde nicht gefunden.
echo Bitte Node.js LTS (22 oder neuer) von https://nodejs.org installieren.
echo.
pause
exit /b 1
