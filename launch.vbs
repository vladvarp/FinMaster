Option Explicit
Dim sh, fso, dir, pyw, app
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
pyw = "pythonw.exe"
app = dir & "\launch.py"
sh.Run """" & pyw & """ """ & app & """", 0, False
