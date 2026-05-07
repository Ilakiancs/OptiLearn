@echo off
NET SESSION >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo Requesting administrator privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)
cd /d "%~dp0"
echo Starting OptiLearn with captive portal (administrator mode)...

echo.
echo Preparing Windows firewall rules for classroom devices...
netsh advfirewall firewall delete rule name="OptiLearn HTTP 8000" >nul 2>&1
netsh advfirewall firewall delete rule name="OptiLearn DNS UDP 53" >nul 2>&1
netsh advfirewall firewall delete rule name="OptiLearn DNS TCP 53" >nul 2>&1
netsh advfirewall firewall add rule name="OptiLearn HTTP 8000" dir=in action=allow protocol=TCP localport=8000 >nul
netsh advfirewall firewall add rule name="OptiLearn DNS UDP 53" dir=in action=allow protocol=UDP localport=53 >nul
netsh advfirewall firewall add rule name="OptiLearn DNS TCP 53" dir=in action=allow protocol=TCP localport=53 >nul

echo.
echo Pointing the Windows hotspot adapter DNS at OptiLearn when available...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ip = Get-NetIPAddress -AddressFamily IPv4 -IPAddress '192.168.137.1' -ErrorAction SilentlyContinue | Select-Object -First 1; if ($ip) { Set-DnsClientServerAddress -InterfaceIndex $ip.InterfaceIndex -ServerAddresses '192.168.137.1'; Write-Host ('Hotspot DNS set on ' + $ip.InterfaceAlias) } else { Write-Host 'Hotspot adapter 192.168.137.1 not found yet; continuing.' }"

echo.
echo Building latest frontend so QR/PWA changes are not stale...
if exist frontend\package.json (
    pushd frontend
    if not exist node_modules\vite-plugin-pwa (
        call npm install
        if errorlevel 1 (
            echo Frontend dependencies could not be installed.
            popd
            pause
            exit /b 1
        )
    )
    call npm run build
    if errorlevel 1 (
        echo Frontend build failed. Fix the build before starting the classroom server.
        popd
        pause
        exit /b 1
    )
    popd
)

echo.
echo Starting server. Keep this window open during class.
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
pause
