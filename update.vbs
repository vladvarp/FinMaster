Option Explicit
' Ждёт закрытия FinMaster и скачивает последний снимок: FinMaster.exe /update
Dim sh, fso, dir, exe, pid, i

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
sh.Run """" & exe & """ /update", 1, False

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
