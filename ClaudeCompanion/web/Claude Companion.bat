@echo off
rem Claude Companion for Windows: run this once (and again after an update).
rem It adds "Claude Companion" to the Start menu (pin it to the taskbar from there), makes the app's
rem small local server start by itself when you sign in, hidden, restarts it, and opens the app.
rem After that, use the Start menu or taskbar: nothing opens a console window.
rem   "Claude Companion.bat uninstall" stops it and removes both shortcuts.
if /i "%~1"=="uninstall" (set "CC_ARG=-Uninstall") else (set "CC_ARG=")
if exist "%SystemRoot%\System32\conhost.exe" (
  start "" "%SystemRoot%\System32\conhost.exe" --headless powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0server.ps1" %CC_ARG%
) else (
  start "" /min powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0server.ps1" %CC_ARG%
)
