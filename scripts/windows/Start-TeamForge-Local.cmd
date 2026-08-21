@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\teamforge.ps1" server
if errorlevel 1 pause
