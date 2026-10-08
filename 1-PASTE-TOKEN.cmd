@echo off
title Paste token here - oslemoncat.github.io
cd /d "%~dp0"
setlocal enabledelayedexpansion

set "TOKENFILE=%~dp0.token-for-dsh.txt"
del /q "%TOKENFILE%" 2>nul

echo ============================================================
echo   PASTE YOUR TOKEN BELOW, THEN PRESS ENTER
echo.
echo   1. Right-click in this window (or press Ctrl+V) to paste
echo   2. Press Enter
echo   3. This window will show [OK] - then just close it
echo.
echo   The token is written straight to a file, there is no
echo   "save" step that can be missed.
echo ============================================================
echo.

set "TOKEN="
set /p "TOKEN=TOKEN> "

if not defined TOKEN (
  echo.
  echo [PROBLEM] Nothing was pasted. Please run this file again.
  echo.
  pause
  exit /b 1
)

> "%TOKENFILE%" echo !TOKEN!

for %%A in ("%TOKENFILE%") do set "SIZE=%%~zA"

echo.
if "%SIZE%"=="0" (
  echo [PROBLEM] Failed to write the file.
) else (
  echo [OK] Token saved: %SIZE% bytes
  echo      File: %TOKENFILE%
  echo      Now tell the assistant: token is ready
)
echo.
pause
