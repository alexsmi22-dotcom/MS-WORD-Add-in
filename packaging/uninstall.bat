@echo off
rem Formula Inserter - per-user uninstaller. Double-click to remove. No admin.
setlocal

set "DIR=%LOCALAPPDATA%\FormulaInserter"
reg delete "HKCU\Software\Microsoft\Office\16.0\WEF\Developer" /v "%DIR%\manifest.xml" /f >nul 2>&1
if exist "%DIR%" rmdir /S /Q "%DIR%"

echo Formula Inserter removed. Restart Word to complete removal.
echo.
pause
