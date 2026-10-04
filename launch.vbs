Option Explicit
' Тихий запуск FinMaster — без консоли и без мигания cmd.
Dim sh, fso, dir, pyw, app, appPy, folderPy, systemPy, mode
Dim BundledSkip
BundledSkip = ""

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir

app = dir & "\launch.py"
If Not fso.FileExists(app) Then
  MsgBox "Не найден launch.py рядом с запускателем.", vbCritical, "FinMaster"
  WScript.Quit 1
End If

folderPy = BundledPythonw(sh, fso)
BundledSkip = folderPy
appPy = dir & "\python\pythonw.exe"
mode = ReadRuntimeMode(fso, sh)
systemPy = FindPythonw(sh, fso)

If fso.FileExists(appPy) Then
  pyw = appPy
ElseIf mode = "system" And systemPy <> "" Then
  pyw = systemPy
ElseIf folderPy <> "" Then
  pyw = folderPy
ElseIf systemPy <> "" Then
  pyw = systemPy
Else
  MsgBox "Python в папке FinMaster ещё не установлен. Запустите FinMaster.exe.", vbCritical, "FinMaster"
  WScript.Quit 1
End If

' 0 = полностью скрытое окно процесса
sh.Run """" & pyw & """ """ & app & """", 0, False
WScript.Quit 0

Function BundledPythonw(sh, fso)
  Dim docs, p
  BundledPythonw = ""
  docs = sh.SpecialFolders("MyDocuments")
  If docs = "" Then Exit Function
  p = docs & "\FinMaster\python\pythonw.exe"
  If fso.FileExists(p) Then BundledPythonw = p
End Function

Function ReadRuntimeMode(fso, sh)
  Dim cfg, ts, text, p, tail
  ReadRuntimeMode = "folder"
  cfg = sh.ExpandEnvironmentStrings("%APPDATA%") & "\FinMaster\config.json"
  If Not fso.FileExists(cfg) Then Exit Function
  On Error Resume Next
  Set ts = fso.OpenTextFile(cfg, 1, False)
  If Err.Number <> 0 Then
    Err.Clear
    On Error Goto 0
    Exit Function
  End If
  text = ts.ReadAll
  ts.Close
  On Error Goto 0
  p = InStr(1, text, """python_runtime""", 1)
  If p = 0 Then Exit Function
  tail = Mid(text, p, 64)
  If InStr(1, tail, """system""", 1) > 0 Then ReadRuntimeMode = "system"
End Function

Function IsSkipped(path)
  Dim folder, bundled, beside
  IsSkipped = False
  If path = "" Then Exit Function
  folder = LCase(fso.GetParentFolderName(path))
  If folder = "" Then Exit Function
  beside = LCase(dir & "\python")
  If folder = beside Then
    IsSkipped = True
    Exit Function
  End If
  If BundledSkip = "" Then Exit Function
  bundled = LCase(fso.GetParentFolderName(BundledSkip))
  If folder = bundled Then IsSkipped = True
End Function

Function FindPythonw(sh, fso)
  Dim p, i, candidates
  FindPythonw = ""

  p = Trim(sh.ExpandEnvironmentStrings("%FINMASTER_PYTHONW%"))
  If p <> "" And p <> "%FINMASTER_PYTHONW%" Then
    If fso.FileExists(p) And Not IsSkipped(p) Then FindPythonw = p : Exit Function
  End If

  ' Обход PATH без запуска cmd (иначе мелькает консоль)
  p = FindInPath(fso, sh, "pythonw.exe")
  If p <> "" Then FindPythonw = p : Exit Function

  ' py.exe на PATH → скрытый запрос пути интерпретатора
  p = FindInPath(fso, sh, "py.exe")
  If p <> "" Then
    p = PythonFromPyLauncher(sh, fso, p)
    If p <> "" And Not IsSkipped(p) Then FindPythonw = p : Exit Function
  End If

  candidates = Array( _
    sh.ExpandEnvironmentStrings("%LOCALAPPDATA%\Programs\Python\Python314\pythonw.exe"), _
    sh.ExpandEnvironmentStrings("%LOCALAPPDATA%\Programs\Python\Python313\pythonw.exe"), _
    sh.ExpandEnvironmentStrings("%LOCALAPPDATA%\Programs\Python\Python312\pythonw.exe"), _
    sh.ExpandEnvironmentStrings("%LOCALAPPDATA%\Programs\Python\Python311\pythonw.exe"), _
    sh.ExpandEnvironmentStrings("%LOCALAPPDATA%\Programs\Python\Python310\pythonw.exe"), _
    sh.ExpandEnvironmentStrings("%ProgramFiles%\Python313\pythonw.exe"), _
    sh.ExpandEnvironmentStrings("%ProgramFiles%\Python312\pythonw.exe"), _
    "C:\Python313\pythonw.exe", _
    "C:\Python312\pythonw.exe", _
    "C:\Python311\pythonw.exe" _
  )
  For i = 0 To UBound(candidates)
    If fso.FileExists(candidates(i)) And Not IsSkipped(candidates(i)) Then FindPythonw = candidates(i) : Exit Function
  Next
End Function

Function FindInPath(fso, sh, exeName)
  Dim pathVar, parts, i, folder, candidate, low
  FindInPath = ""
  pathVar = sh.ExpandEnvironmentStrings("%PATH%")
  parts = Split(pathVar, ";")
  For i = 0 To UBound(parts)
    folder = Trim(parts(i))
    If folder <> "" Then
      low = LCase(folder)
      ' Пропускаем заглушки Microsoft Store — они мигают/открывают Store
      If InStr(low, "\windowsapps") = 0 Then
        If Right(folder, 1) <> "\" Then folder = folder & "\"
        candidate = folder & exeName
        If fso.FileExists(candidate) And Not IsSkipped(candidate) Then
          FindInPath = candidate
          Exit Function
        End If
      End If
    End If
  Next
End Function

Function PythonFromPyLauncher(sh, fso, pyExe)
  Dim tmp, cmd, ts, line, p
  PythonFromPyLauncher = ""
  tmp = fso.GetSpecialFolder(2) & "\finmaster_py_" & Timer * 1000 & ".txt"
  ' Окно 0 — без консоли; ждём завершения
  cmd = """" & pyExe & """ -3 -c ""import sys;print(sys.executable)"" > """ & tmp & """ 2>NUL"
  sh.Run "cmd /c " & cmd, 0, True
  If Not fso.FileExists(tmp) Then Exit Function
  On Error Resume Next
  Set ts = fso.OpenTextFile(tmp, 1)
  If Err.Number = 0 Then
    If Not ts.AtEndOfStream Then line = Trim(ts.ReadLine)
    ts.Close
  End If
  On Error Goto 0
  fso.DeleteFile tmp, True
  p = ToPythonw(line)
  If p <> "" And fso.FileExists(p) Then PythonFromPyLauncher = p
End Function

Function ToPythonw(pythonExe)
  Dim low, p
  ToPythonw = ""
  p = Trim(pythonExe & "")
  If p = "" Then Exit Function
  low = LCase(p)
  If Right(low, 10) = "python.exe" Then
    ToPythonw = Left(p, Len(p) - 10) & "pythonw.exe"
  ElseIf Right(low, 11) = "pythonw.exe" Then
    ToPythonw = p
  End If
End Function
