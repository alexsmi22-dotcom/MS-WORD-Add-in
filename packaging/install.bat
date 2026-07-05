@echo off
rem JurisLab - per-user installer for Word on Windows (no admin).
rem Double-click this file. It copies the manifest and registers the add-in for
rem your user account. Then restart Word.
setlocal

set "DIR=%LOCALAPPDATA%\FormulaInserter"
if not exist "%DIR%" mkdir "%DIR%"
copy /Y "%~dp0manifest.xml" "%DIR%\manifest.xml" >nul
if errorlevel 1 (
  echo Could not find manifest.xml next to this installer.
  pause
  exit /b 1
)

reg add "HKCU\Software\Microsoft\Office\16.0\WEF\Developer" /v "%DIR%\manifest.xml" /t REG_SZ /d "%DIR%\manifest.xml" /f >nul

echo.
echo   JurisLab installed for your user account.
echo.
echo   Next steps:
echo     1. Fully close and reopen Word (all windows).
echo     2. Insert tab ^> Add-ins ^> Developer Add-ins ^> JurisLab.
echo.
echo   To remove it later, run uninstall.bat.
echo.
pause
