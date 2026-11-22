@echo off
rem Claude Companion for Windows. Sets the app's small local server to start by itself when you sign in
rem (hidden, no window), restarts it so an update takes effect, and opens the app.
rem   "Claude Companion.bat uninstall" stops it and removes it from startup.
if /i "%~1"=="uninstall" (set "CC_ARG=-Uninstall") else (set "CC_ARG=")
start "" /min powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0server.ps1" %CC_ARG%
