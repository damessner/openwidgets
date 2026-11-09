@echo off
REM ============================================================================
REM  OpenWidgets - lokaler Testserver auf diesem Windows-Rechner
REM
REM  Doppelklicken zum Starten. Beenden mit Strg+C oder Fenster schliessen.
REM  Daten liegen in %LOCALAPPDATA%\OpenWidgets\data (NICHT im OneDrive-Ordner).
REM  Nur zum Testen gedacht: kein TLS, keine Absicherung fuer echte Noten.
REM ============================================================================
setlocal EnableExtensions
chcp 65001 >nul
title OpenWidgets - lokaler Testserver
cd /d "%~dp0"

REM ---- Konfiguration ---------------------------------------------------------
if not defined PORT set "PORT=3000"
if not defined HOST set "HOST=0.0.0.0"
if not defined OW_DATA_DIR set "OW_DATA_DIR=%LOCALAPPDATA%\OpenWidgets\data"
set "DATA_DIR=%OW_DATA_DIR%"
set "CHECK_ONLY="
if /I "%~1"=="--check" set "CHECK_ONLY=1"
set "NO_BROWSER="
if /I "%~1"=="--no-browser" set "NO_BROWSER=1"

REM ---- Node.js suchen --------------------------------------------------------
call :find_node
if errorlevel 1 goto :node_missing

"%NODE_EXE%" -e "process.exit(parseInt(process.versions.node,10)>=22?0:1)" >nul 2>nul
if errorlevel 1 goto :node_too_old

REM ---- Datenverzeichnis anlegen ---------------------------------------------
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%" >nul 2>nul
if not exist "%DATA_DIR%" goto :data_failed

set "FIRST_START=nein"
if not exist "%DATA_DIR%\openwidgets.db" set "FIRST_START=ja"

if defined CHECK_ONLY goto :check_output

REM ---- Lokale IP fuer Schueler-Links ermitteln (ohne Pipes, damit Batch sicher bleibt)
if not defined LAN_IP for /f "usebackq delims=" %%i in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "([System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName())).Where({$_.AddressFamily -eq 'InterNetwork'})[0].IPAddressToString" 2^>nul`) do set "LAN_IP=%%i"
if not defined LAN_IP set "LAN_IP=127.0.0.1"

REM ---- Erststart: Admin-Konto anlegen ---------------------------------------
if "%FIRST_START%"=="nein" goto :print_banner
REM Im Demo-Modus sind Konto und Inhalte bereits vorkonfiguriert.
if "%OW_DEMO_MODE%"=="1" goto :print_banner
echo.
echo ==============================================================
echo   Erststart: Admin-Konto fuer diese Test-Instanz anlegen
echo   (nur fuer diesen Laptop gedacht - keine echten Schuelerdaten)
echo ==============================================================
if defined ADMIN_EMAIL goto :ask_name
set /p "ADMIN_EMAIL=Admin-E-Mail [admin@schule.local]: "
if not defined ADMIN_EMAIL set "ADMIN_EMAIL=admin@schule.local"
:ask_name
if defined ADMIN_NAME goto :ask_password
set /p "ADMIN_NAME=Anzeigename [Administrator]: "
if not defined ADMIN_NAME set "ADMIN_NAME=Administrator"
:ask_password
if defined ADMIN_PASSWORD goto :account_ready
set /p "ADMIN_PASSWORD=Passwort (mindestens 10 Zeichen): "
if not defined ADMIN_PASSWORD set "ADMIN_PASSWORD=openwidgets-test"
:account_ready
echo.

:print_banner
echo ==============================================================
echo   OpenWidgets laeuft gleich - Testbetrieb auf diesem Laptop
echo ==============================================================
if "%OW_DEMO_MODE%"=="1" echo   *** DEMO-MODUS: Login "admin" / Passwort "admin" ***
if "%OW_DEMO_MODE%"=="1" echo   *** Schwaches Testpasswort - keine echten Daten! ***
if "%OW_DEMO_MODE%"=="1" echo.
echo   Lehrkraft-Login:  http://localhost:%PORT%/login
if defined ADMIN_EMAIL echo   Admin-Konto:      %ADMIN_EMAIL%
echo.
echo   Schueler:innen im gleichen WLAN/Netz oeffnen:
echo                     http://%LAN_IP%:%PORT%/
echo   (Aufgaben-Code von der Lehrkraft eintippen)
echo.
echo   Daten:            %DATA_DIR%
if "%OW_DEMO_MODE%"=="1" echo   Demo-Inhalte:     4 fertige Aktivitaeten sind bereits geladen
if not "%OW_DEMO_MODE%"=="1" echo   Demo-Inhalte:     in zweitem Fenster seed-demo.bat starten
echo   Beenden:          Strg+C oder dieses Fenster schliessen
echo ==============================================================
echo.

REM ---- Browser oeffnen und Server starten -----------------------------------
if not defined NO_BROWSER start "" "http://localhost:%PORT%/"
"%NODE_EXE%" server\index.js

echo.
echo Server beendet. Dieses Fenster kann geschlossen werden.
pause
goto :eof

REM ============================================================================
REM  Unterprogramme
REM ============================================================================

:find_node
set "NODE_EXE="
where node >nul 2>nul
if not errorlevel 1 set "NODE_EXE=node"
if defined NODE_EXE exit /b 0
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if defined NODE_EXE exit /b 0
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if defined NODE_EXE exit /b 0
REM Fallback: Node, das mit dem DeepSeek Harness ausgeliefert wurde (dieser Rechner)
if exist "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" set "NODE_EXE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if defined NODE_EXE exit /b 0
exit /b 1

:check_output
echo NODE_EXE=%NODE_EXE%
echo PORT=%PORT%
echo HOST=%HOST%
echo DATA_DIR=%DATA_DIR%
echo FIRST_START=%FIRST_START%
echo DEMO_MODE=%OW_DEMO_MODE%
exit /b 0

:node_missing
echo.
echo FEHLER: Node.js wurde nicht gefunden.
echo Bitte Node.js LTS (22 oder neuer) von https://nodejs.org installieren
echo und dieses Skript erneut starten.
echo.
pause
exit /b 1

:node_too_old
echo.
echo FEHLER: Node.js ist zu alt. OpenWidgets braucht mindestens Version 22.5.
echo Installiert gefunden: "%NODE_EXE%"
echo Bitte Node.js LTS (24 empfohlen) installieren.
echo.
pause
exit /b 1

:data_failed
echo.
echo FEHLER: Datenverzeichnis konnte nicht angelegt werden:
echo   %DATA_DIR%
echo.
pause
exit /b 1
