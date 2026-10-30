@echo off
:: Проверка прав администратора
net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

:: Завершение ngrok
taskkill /F /IM ngrok.exe /T >nul 2>&1

exit /b