@echo off
REM ============================================================================
REM  OpenWidgets - DEMO-MODUS zum schnellen Ausprobieren
REM
REM  Startet eine separate Test-Instanz mit:
REM    * fixem Login:  admin / admin
REM    * fertigen Demo-Arbeitsblaettern (Biologie, Mathematik, Deutsch) + Quiz
REM    * eigenem Datenordner (%LOCALAPPDATA%\OpenWidgets\demo-data)
REM
REM  Nur zum Anschauen/Testen. Kein HTTPS, schwaches Passwort, keine echten
REM  Schueler:innen-Daten. Fuer den echten Betrieb: start-openwidgets.bat.
REM
REM  Neu anfangen:  start-demo.bat --reset
REM ============================================================================
setlocal EnableExtensions
chcp 65001 >nul
title OpenWidgets - DEMO-MODUS
cd /d "%~dp0"

set "OW_DEMO_MODE=1"
set "OW_SEED_DEMO=1"
if not defined OW_DATA_DIR set "OW_DATA_DIR=%LOCALAPPDATA%\OpenWidgets\demo-data"
if not defined PORT set "PORT=3000"
if not defined ADMIN_EMAIL set "ADMIN_EMAIL=admin@schule.local"
if not defined ADMIN_NAME set "ADMIN_NAME=Admin"
if not defined ADMIN_PASSWORD set "ADMIN_PASSWORD=admin"

if /I "%~1"=="--reset" (
  echo Demo-Daten werden zurueckgesetzt: "%OW_DATA_DIR%"
  if exist "%OW_DATA_DIR%" rmdir /s /q "%OW_DATA_DIR%"
  shift
)

call "%~dp0start-openwidgets.bat" %*
