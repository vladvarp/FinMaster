Option Explicit
' Запуск FinMaster без окна консоли (двойной щелчок — без мигания cmd).
' Эквивалент run.bat / launch.vbs.
Dim sh, fso, dir
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "wscript.exe //nologo """ & dir & "\launch.vbs""", 0, False
