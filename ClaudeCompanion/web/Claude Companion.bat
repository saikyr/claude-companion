@echo off
rem Starts the Claude Companion app (a small local server) and opens it.
start "Claude Companion" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
