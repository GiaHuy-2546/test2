@echo off
title Valorant Ban/Pick Controller
cd /d "%~dp0"

:: Bước 1: Kiểm tra xem đã cài thư viện chưa
if not exist "node_modules" (
    echo [CANH BAO] Ban chua cai thu vien! Dang chay 'npm install' lan dau tien...
    call npm install
)

echo ======================================================
echo    DANG KHOI DONG HE THONG BAN/PICK VALORANT
echo ======================================================

:: Bước 2: Chạy Server Node.js trong một cửa sổ riêng
echo 1. Dang bat Server Node.js (Port 3000)...
start "NodeJS Server" cmd /k "node server.js"

:: Đợi 3 giây để server kịp chạy
timeout /t 3 /nobreak >nul

:: Bước 3: Chạy Cloudflare Tunnel ở cửa sổ hiện tại để lấy Link
echo.
echo 2. Dang ket noi Cloudflare Tunnel...
echo.
echo ------------------------------------------------------
echo   LUU Y: Copy duong link co duoi ".trycloudflare.com"
echo   ben duoi va gui cho ban be.
echo ------------------------------------------------------
echo.

:: Lệnh chạy Cloudflare
:: Nếu bạn để file cloudflared.exe cùng thư mục thì dùng dòng dưới:
cloudflared tunnel --url http://localhost:3000

:: Nếu lệnh trên lỗi, máy sẽ dừng lại để bạn đọc lỗi
pause