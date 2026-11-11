@echo off
setlocal
if not exist "%~dp0app.js" exit /b 1
if not exist "%~dp0package.json" exit /b 1
if exist "%~dp0DISTANCE_AND_NEXT_STEPS.md" del /q "%~dp0DISTANCE_AND_NEXT_STEPS.md"
if exist "%~dp0docs\history\DISTANCE_AND_NEXT_STEPS.md" del /q "%~dp0docs\history\DISTANCE_AND_NEXT_STEPS.md"
if exist "%~dp0KAKAO_SETUP.md" del /q "%~dp0KAKAO_SETUP.md"
if exist "%~dp0docs\history\KAKAO_SETUP.md" del /q "%~dp0docs\history\KAKAO_SETUP.md"
if exist "%~dp0LOCATION_ACCURACY.md" del /q "%~dp0LOCATION_ACCURACY.md"
if exist "%~dp0docs\history\LOCATION_ACCURACY.md" del /q "%~dp0docs\history\LOCATION_ACCURACY.md"
if exist "%~dp0LOCATION_MAP_UPDATE.md" del /q "%~dp0LOCATION_MAP_UPDATE.md"
if exist "%~dp0docs\history\LOCATION_MAP_UPDATE.md" del /q "%~dp0docs\history\LOCATION_MAP_UPDATE.md"
if exist "%~dp0PUBLIC_DATA_SETUP.md" del /q "%~dp0PUBLIC_DATA_SETUP.md"
if exist "%~dp0docs\history\PUBLIC_DATA_SETUP.md" del /q "%~dp0docs\history\PUBLIC_DATA_SETUP.md"
if exist "%~dp0REFERENCE_REVIEW.md" del /q "%~dp0REFERENCE_REVIEW.md"
if exist "%~dp0docs\history\REFERENCE_REVIEW.md" del /q "%~dp0docs\history\REFERENCE_REVIEW.md"
if exist "%~dp0REPORT_UPDATE.md" del /q "%~dp0REPORT_UPDATE.md"
if exist "%~dp0docs\history\REPORT_UPDATE.md" del /q "%~dp0docs\history\REPORT_UPDATE.md"
if exist "%~dp0ROUTING_SETUP.md" del /q "%~dp0ROUTING_SETUP.md"
if exist "%~dp0docs\history\ROUTING_SETUP.md" del /q "%~dp0docs\history\ROUTING_SETUP.md"
if exist "%~dp0docs\history\README.md" del /q "%~dp0docs\history\README.md"
if exist "%~dp0docs\DESIGN.md" del /q "%~dp0docs\DESIGN.md"
if exist "%~dp0APPLY_UPDATE.ps1" del /q "%~dp0APPLY_UPDATE.ps1"
if exist "%~dp0docs\history\" rd "%~dp0docs\history" 2>nul
echo Obsolete documentation removed. Current docs and .env kept.
endlocal
