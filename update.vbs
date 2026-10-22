Option Explicit
' Ждёт закрытия окна и сам скачивает последний снимок. FinMaster.exe не запускает.
Dim sh, fso, dir, pid, i, pyw, rc

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
pid = ""
If WScript.Arguments.Count > 0 Then pid = Trim(WScript.Arguments(0))

If pid <> "" Then
  For i = 1 To 100
    If Not PidAlive(pid) Then Exit For
    WScript.Sleep 200
  Next
End If

pyw = FindPythonw()
If pyw = "" Then
  MsgBox "Python в папке FinMaster ещё не установлен. Запустите программу как обычно.", vbCritical, "FinMaster"
  WScript.Quit 1
End If

sh.CurrentDirectory = dir
sh.Environment("PROCESS")("FM_UPDATE_DIR") = dir
rc = sh.Run("""" & pyw & """ -c ""from backend.setup import update_folder; update_folder()""", 0, True)
If rc <> 0 Then WScript.Quit rc

If fso.FileExists(dir & "\launch.vbs") Then
  sh.Run "wscript.exe //nologo """ & dir & "\launch.vbs""", 0, False
End If

Function FindPythonw()
  Dim beside, docs, folderPy, systemPy
  FindPythonw = ""
  beside = dir & "\python\pythonw.exe"
  docs = sh.SpecialFolders("MyDocuments")
  folderPy = ""
  If docs <> "" Then
    If fso.FileExists(docs & "\FinMaster\python\pythonw.exe") Then folderPy = docs & "\FinMaster\python\pythonw.exe"
  End If
  systemPy = FindInPath("pythonw.exe")
  If fso.FileExists(beside) Then
    FindPythonw = beside
  ElseIf ReadRuntimeMode() = "system" And systemPy <> "" Then
    FindPythonw = systemPy
  ElseIf folderPy <> "" Then
    FindPythonw = folderPy
  Else
    FindPythonw = systemPy
  End If
End Function

Function ReadRuntimeMode()
  Dim cfg, ts, text, p, tail
  ReadRuntimeMode = "folder"
  cfg = sh.ExpandEnvironmentStrings("%APPDATA%") & "\FinMaster\config.json"
  If Not fso.FileExists(cfg) Then Exit Function
  On Error Resume Next
  Set ts = fso.OpenTextFile(cfg, 1, False)
  If Err.Number <> 0 Then
    Err.Clear
    On Error GoTo 0
    Exit Function
  End If
  text = ts.ReadAll
  ts.Close
  On Error GoTo 0
  p = InStr(1, text, """python_runtime""", 1)
  If p = 0 Then Exit Function
  tail = Mid(text, p, 64)
  If InStr(1, tail, """system""", 1) > 0 Then ReadRuntimeMode = "system"
End Function

Function FindInPath(exeName)
  Dim pathVar, parts, i, folder, candidate, low
  FindInPath = ""
  pathVar = sh.ExpandEnvironmentStrings("%PATH%")
  parts = Split(pathVar, ";")
  For i = 0 To UBound(parts)
    folder = Trim(parts(i))
    If folder <> "" Then
      low = LCase(folder)
      If InStr(low, "\windowsapps") = 0 Then
        If Right(folder, 1) <> "\" Then folder = folder & "\"
        candidate = folder & exeName
        If fso.FileExists(candidate) Then
          FindInPath = candidate
          Exit Function
        End If
      End If
    End If
  Next
End Function

Function PidAlive(id)
  Dim svc, found
  PidAlive = False
  On Error Resume Next
  Set svc = GetObject("winmgmts:\\.\root\cimv2")
  If svc Is Nothing Then Exit Function
  found = svc.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE ProcessId=" & CLng(id)).Count
  If Err.Number = 0 And found > 0 Then PidAlive = True
  Err.Clear
End Function
