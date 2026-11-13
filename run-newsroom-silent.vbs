' Script chạy ngầm Dây chuyền Tòa Soạn AI (NotebookLM x Antigravity) mỗi sáng không hiện cửa sổ đen CMD
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "D:\Anti\news-portal"
WshShell.Run "cmd.exe /c node D:\Anti\news-portal\notebooklm-newsroom.mjs >> D:\Anti\news-portal\newsroom-daily.log 2>&1", 0, False
