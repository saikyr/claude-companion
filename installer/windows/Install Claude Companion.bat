@echo off
rem Installs Claude Companion into WoW Forever (finds the game folder, or asks), then opens the app.
rem Run it again any time to repair. Your saved data is never touched.
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0files\install.ps1"
