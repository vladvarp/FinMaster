@echo off
REM Для запуска без мигания консоли используйте run.vbs (двойной щелчок).
REM Этот .bat оставлен для вызова из уже открытого терминала.
cd /d "%~dp0"
wscript //nologo "%~dp0launch.vbs"
exit /b 0
