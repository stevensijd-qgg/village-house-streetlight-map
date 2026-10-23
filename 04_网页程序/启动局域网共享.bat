@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 何桥村出租房屋查询 - 局域网共享
echo ================================================
echo    何桥村出租房屋查询 —— 局域网共享服务
echo ================================================
echo.

where python >nul 2>nul
if errorlevel 1 (
    echo [错误] 本机没有找到 Python，无法启动共享。
    echo 请在装有 Python 的电脑上运行本脚本。
    pause
    exit /b
)

echo 其他人（手机/电脑）连接和本机 同一个WiFi/路由器 后，
echo 用浏览器打开下面任意一个地址即可查看：
echo.
for /f %%a in ('powershell -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -notlike '169.*' -and $_.IPAddress -ne '127.0.0.1'} | Select-Object -ExpandProperty IPAddress"') do echo     http://%%a:8000
echo.
echo 提示：
echo  1) 首次启动如弹出“Windows防火墙”窗口，请勾选“专用网络”并点击【允许访问】；
echo  2) 手机看卫星底图仍需手机自己能上网（流量或WiFi均可）；
echo  3) 关闭本窗口即停止共享，不影响文件本身。
echo.
echo 服务运行中，请保持本窗口开启……
echo ------------------------------------------------
python -m http.server 8000 --bind 0.0.0.0
pause
