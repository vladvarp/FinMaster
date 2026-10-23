Option Explicit
' Ждёт закрытия FinMaster. Снимок качает Python из папки, не код внутри FinMaster.exe.
Dim sh, fso, dir, exe, pid, i, env, pyw

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
exe = dir & "\FinMaster.exe"
pid = ""
If WScript.Arguments.Count > 0 Then pid = Trim(WScript.Arguments(0))

If Not fso.FileExists(exe) Then
  MsgBox "Рядом нет FinMaster.exe.", vbCritical, "FinMaster"
  WScript.Quit 1
End If

If pid <> "" Then
  For i = 1 To 100
    If Not PidAlive(pid) Then Exit For
    WScript.Sleep 200
  Next
  ' Окно уже закрыто. Пауза, чтобы программа отпустила свою копию до запуска exe.
  WScript.Sleep 600
End If

sh.CurrentDirectory = dir
' Снимок качает Python из папки: в FinMaster.exe логика скачивания старая.
pyw = Pythonw(sh, fso, dir)
If pyw <> "" Then
  sh.Run """" & pyw & """ -c ""from backend.setup import update_folder; update_folder()""", 1, False
  WScript.Quit 0
End If

' Иначе exe думает, что он продолжение уже открытой копии, и не стартует.
Set env = sh.Environment("PROCESS")
env("PYINSTALLER_RESET_ENVIRONMENT") = "1"
On Error Resume Next
env.Remove "_PYI_PARENT_PROCESS_LEVEL"
env.Remove "_PYI_APPLICATION_HOME_DIR"
env.Remove "_PYI_ARCHIVE_FILE"
env.Remove "_PYI_SPLASH_IPC"
On Error GoTo 0
sh.Run """" & exe & """ /update", 1, False

Function Pythonw(sh, fso, dir)
  Dim docs, beside, folder
  Pythonw = ""
  beside = dir & "\python\pythonw.exe"
  If fso.FileExists(beside) Then
    Pythonw = beside
    Exit Function
  End If
  docs = sh.SpecialFolders("MyDocuments")
  If docs = "" Then Exit Function
  folder = docs & "\FinMaster\python\pythonw.exe"
  If fso.FileExists(folder) Then Pythonw = folder
End Function

Function PidAlive(id)
  Dim svc, found
  ' Если проверить не удалось, считаем процесс живым и ждём дальше.
  PidAlive = True
  On Error Resume Next
  Set svc = GetObject("winmgmts:\\.\root\cimv2")
  If svc Is Nothing Then Exit Function
  found = svc.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE ProcessId=" & CLng(id)).Count
  If Err.Number <> 0 Then Exit Function
  If found = 0 Then PidAlive = False
End Function
