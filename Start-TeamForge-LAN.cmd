@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\teamforge.ps1" server -Lan -GenerateToken
if errorlevel 1 pause
