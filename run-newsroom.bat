@echo off
chcp 65001 >nul
title Toa Soan AI NotebookLM - Tu Dong Tong Hop Ban Tin
cd /d "%~dp0"
echo ==================================================================
echo    Đang chạy Dây chuyền Tòa Soạn AI (NotebookLM x Antigravity)...
echo    Quá trình tạo sổ tay, nạp nguồn và biên tập mất khoảng 60-90s.
echo ==================================================================
node notebooklm-newsroom.mjs
pause
