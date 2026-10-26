Option Explicit
' Удаление FinMaster. Запуск без аргументов — окно с галочками.
' launch.vbs вызывает: wscript uninstall.vbs /register
' Галочки по умолчанию: папка программы (ярлыки, иконки .fmaster/.fbak/.fmwb/.fms, автозагрузка) и Python в Документы\FinMaster\python.
' Выключены: папка %APPDATA%\FinMaster (config.json), история, резервные копии, отчёты .fmaster. Эти четыре пункта уходят в корзину.

Const HKCU = &H80000001

Dim sh, fso, removed, problems, utf8Broken
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
removed = ""
problems = ""
' wscript читает этот UTF-8 файл как ANSI. T() возвращает нормальную кириллицу.
utf8Broken = ("У" <> ChrW(&H423))

Dim arg0, progDir
progDir = fso.GetParentFolderName(WScript.ScriptFullName)
arg0 = ""
If WScript.Arguments.Count >= 1 Then arg0 = LCase(Trim(WScript.Arguments(0) & ""))

If arg0 = "/register" Or arg0 = "-register" Then
  RegisterInstall progDir
  WScript.Quit 0
End If

If arg0 = "/go" Or arg0 = "-go" Then
  If WScript.Arguments.Count < 2 Then
    MsgBox T("Не передана папка программы."), vbCritical, "FinMaster"
    WScript.Quit 1
  End If
  RunUninstall WScript.Arguments(1), True
  WScript.Quit 0
End If

RelaunchFromTemp progDir
WScript.Quit 0

Sub RelaunchFromTemp(folder)
  Dim dest, src
  src = WScript.ScriptFullName
  dest = TempDir() & "\uninstall.vbs"
  If Norm(src) = Norm(dest) Then
    RunUninstall folder, True
    Exit Sub
  End If
  On Error Resume Next
  fso.CopyFile src, dest, True
  If Err.Number <> 0 Then
    Err.Clear
    On Error GoTo 0
    RunUninstall folder, False
    Exit Sub
  End If
  On Error GoTo 0
  sh.Run "wscript.exe //nologo """ & dest & """ /go """ & folder & """", 0, False
End Sub

Sub RunUninstall(folder, fromTemp)
  Dim choice, doProg, doPython, doConfig, doHistory, doBackups, doReports
  Dim py, cfg, dir
  choice = Ask(folder)
  If choice = "" Then Exit Sub

  doProg = HasFlag(choice, "prog")
  doPython = HasFlag(choice, "python")
  doConfig = HasFlag(choice, "config")
  doHistory = HasFlag(choice, "history")
  doBackups = HasFlag(choice, "backups")
  doReports = HasFlag(choice, "reports")

  On Error Resume Next
  folder = fso.GetAbsolutePathName(folder)
  On Error GoTo 0

  CloseApp folder

  If doProg Then
    If Unsafe(folder) Then
      If IsRepo(folder) Then
        AddProblem T("Папка репозитория не удаляется: ") & folder
      Else
        AddProblem T("Папку программы удалять нельзя: ") & folder
      End If
      doProg = False
    Else
      RemoveShortcuts folder
      RemoveAssociations
      RemoveAutostart folder
      RemoveUninstallKey folder
      If Not doConfig Then RemoveServiceFiles
      AddRemoved T("Ярлыки, привязка иконок и автозагрузка")
    End If
  End If

  py = ReportsRoot() & "\python"
  If doPython Then
    If Not IsNamedChild(py, "python") Then
      AddProblem T("Неверная папка Python: ") & py
    ElseIf fso.FolderExists(py) Then
      RemoveFolder py
      If fso.FolderExists(py) Then
        AddProblem T("Не удалось удалить Python: ") & py
      Else
        AddRemoved T("Python в папке отчётов")
      End If
    End If
  End If

  If doHistory Then RecycleNamed ReportsRoot() & "\history", "history", T("История отчётов")
  If doBackups Then RecycleNamed ReportsRoot() & "\backups", "backups", T("Резервные копии")
  If doReports Then RecycleReports

  cfg = ConfigFile()
  dir = AppDataDir()
  If doConfig Then
    If Not IsAppDataFinMaster(dir) Then
      AddProblem T("Неверная папка настроек: ") & dir
    ElseIf fso.FolderExists(dir) Then
      If RecycleOne(dir) Then
        AddRemoved T("Папка настроек")
      Else
        AddProblem T("Не удалось убрать папку настроек: ") & dir
      End If
    End If
  ElseIf fso.FileExists(cfg) And (doProg Or doPython) Then
    PatchConfig cfg, doProg, doPython
  End If

  If doProg Then
    If fromTemp Then
      RemoveFolder folder
      If fso.FolderExists(folder) Then
        AddProblem T("Не удалось удалить папку программы. Закройте FinMaster и запустите удаление снова.")
      Else
        AddRemoved T("Папка программы")
      End If
    Else
      ScheduleDelete folder
      AddRemoved T("Папка программы будет удалена после закрытия этого окна")
    End If
  End If

  ShowResult
End Sub

Function Ask(folder)
  Dim hta, result, ts
  Ask = ""
  result = TempDir() & "\choice.txt"
  On Error Resume Next
  If fso.FileExists(result) Then fso.DeleteFile result, True
  On Error GoTo 0
  hta = TempDir() & "\uninstall.hta"
  Set ts = fso.CreateTextFile(hta, True, True)
  ts.Write BuildHta(folder, result)
  ts.Close
  sh.Run "mshta.exe """ & hta & """", 1, True
  If Not fso.FileExists(result) Then Exit Function
  Set ts = fso.OpenTextFile(result, 1, False)
  If Not ts.AtEndOfStream Then Ask = Trim(ts.ReadAll)
  ts.Close
End Function

Function BuildHta(folder, resultPath)
  Dim py, docs, cfg, dir, html, progOn, progHint
  docs = ReportsRoot()
  py = docs & "\python"
  dir = AppDataDir()
  cfg = ConfigFile()
  progOn = True
  progHint = HtmlEsc(folder) & "<br><span class=""warn"">" & T("Ярлыки, привязка .fmaster, .fbak, .fmwb и .fms, автозагрузка и запись в списке программ. Python внутри папки программы удаляется вместе с ней.") & "</span>"
  If IsRepo(folder) Then
    progOn = False
    progHint = HtmlEsc(folder) & "<br><span class=""warn"">" & T("Это папка репозитория, она не удаляется.") & "</span>"
  End If
  html = "<html><head><meta http-equiv=""x-ua-compatible"" content=""ie=9"">"
  html = html & "<HTA:APPLICATION ID=""u"" BORDER=""dialog"" CAPTION=""yes"" SCROLL=""no"" SINGLEINSTANCE=""yes"" SYSMENU=""yes"" SHOWINTASKBAR=""yes"">"
  html = html & "<style>"
  html = html & "html,body{margin:0;background:#e8eef4;font-family:Segoe UI,sans-serif;color:#0f172a;}"
  html = html & ".card{background:#fff;margin:16px;padding:18px 22px 16px;border:1px solid #dbe3ec;}"
  html = html & "h1{font-size:16px;font-weight:600;margin:0 0 6px;}"
  html = html & "p{color:#64748b;font-size:12px;line-height:1.4;margin:0 0 12px;}"
  html = html & "label{display:block;margin:9px 0 0;font-size:13px;}"
  html = html & ".hint{display:block;margin:1px 0 0 22px;color:#64748b;font-size:11px;line-height:1.35;}"
  html = html & ".hint .warn{color:#ea580c;}"
  html = html & ".buttons{margin-top:16px;text-align:right;}"
  html = html & "button{font-family:Segoe UI,sans-serif;font-size:13px;padding:6px 14px;margin-left:8px;border:1px solid #dbe3ec;background:#e8eef4;color:#0f172a;}"
  html = html & "button.danger{background:#dc2626;color:#fff;border-color:#dc2626;}"
  html = html & "</style>"
  html = html & "<script language=""javascript"">function ok(){"
  html = html & "var ids=['prog','python','config','history','backups','reports'];var picked=[];var i;"
  html = html & "for(i=0;i<ids.length;i++){if(document.getElementById(ids[i]).checked)picked.push(ids[i]);}"
  html = html & "if(!picked.length){alert('" & JsEsc(T("Отметьте хотя бы один пункт.")) & "');return;}"
  html = html & "var fso=new ActiveXObject('Scripting.FileSystemObject');"
  html = html & "var ts=fso.CreateTextFile('" & JsEsc(resultPath) & "',true);ts.Write(picked.join(','));ts.Close();close();}"
  html = html & "function cancel(){close();}"
  html = html & "document.onkeyup=function(e){e=e||window.event;if(e.keyCode==27)cancel();};"
  html = html & "window.resizeTo(600,680);window.moveTo((screen.availWidth-520)/2,(screen.availHeight-860)/3);"
  html = html & "</script></head><body><div class=""card"">"
  html = html & "<h1>" & T("Удаление FinMaster") & "</h1>"
  html = html & "<p>" & T("Отчёты, история, копии и настройки при включении уходят в корзину. Папка программы и Python стираются сразу. Если программа открыта, она закроется.") & "</p>"
  html = html & Box("prog", progOn, T("Папка программы, ярлыки и интерпретация иконок"), progHint)
  html = html & Box("python", False, T("Python"), HtmlEsc(py))
  html = html & Box("config", False, T("Папка настроек и файл конфигурации"), HtmlEsc(dir) & "<br>" & HtmlEsc(cfg) & "<br><span class=""warn"">" & T("Пропадут недавние файлы, тема, профили, формулы, токен сессии телефона, токен ngrok и токен Telegram. Их придётся вводить заново. Сами отчёты останутся. Папка уходит в корзину.") & "</span>")
  html = html & Box("history", False, T("История отчётов"), HtmlEsc(docs & "\history") & "<br><span class=""warn"">" & T("Пропадут снимки правок: отмена, повтор и сравнение с прошлыми версиями. Сами отчёты останутся. Папка уходит в корзину.") & "</span>")
  html = html & Box("backups", False, T("Резервные копии"), HtmlEsc(docs & "\backups") & "<br><span class=""warn"">" & T("Пропадут запасные копии. Если отчёт испортится, вернуть прежнюю версию будет нечем. Копии уходят в корзину.") & "</span>")
  html = html & Box("reports", False, T("Отчёты .fmaster в папке FinMaster"), HtmlEsc(docs) & "<br><span class=""warn"">" & T("Пропадут заказы и заказчики из этих файлов. Отчёты в других папках не трогаются. Файлы уходят в корзину.") & "</span>")
  html = html & "<div class=""buttons""><button onclick=""cancel()"">" & T("Отмена") & "</button><button class=""danger"" onclick=""ok()"">" & T("Удалить") & "</button></div>"
  html = html & "</div></body></html>"
  BuildHta = html
End Function

Function Box(id, checked, title, hint)
  Dim mark
  mark = ""
  If checked Then mark = " checked"
  Box = "<label><input type=""checkbox"" id=""" & id & """" & mark & "> " & HtmlEsc(title) & "</label><span class=""hint"">" & hint & "</span>"
End Function

Function HtmlEsc(text)
  HtmlEsc = Replace(Replace(Replace(Replace(text & "", "&", "&amp;"), "<", "&lt;"), ">", "&gt;"), """", "&quot;")
End Function

Function JsEsc(text)
  JsEsc = Replace(Replace(text & "", "\", "\\"), "'", "\'")
End Function

Function T(text)
  If Not utf8Broken Then
    T = text
    Exit Function
  End If
  On Error Resume Next
  T = Utf8Text(text)
  If Err.Number <> 0 Or (T = "" And text <> "") Then
    Err.Clear
    T = text
  End If
  On Error GoTo 0
End Function

Function Utf8Text(text)
  Dim bin, out, raw
  Set bin = CreateObject("ADODB.Stream")
  bin.Type = 2
  bin.Charset = AnsiCharset()
  bin.Open
  bin.WriteText text
  bin.Position = 0
  bin.Type = 1
  bin.Position = 0
  raw = bin.Read
  bin.Close
  Set out = CreateObject("ADODB.Stream")
  out.Type = 1
  out.Open
  out.Write raw
  out.Position = 0
  out.Type = 2
  out.Charset = "utf-8"
  Utf8Text = out.ReadText
  out.Close
End Function

Function AnsiCharset()
  Dim reg, cp
  cp = ""
  On Error Resume Next
  Set reg = GetObject("winmgmts:\\.\root\default:StdRegProv")
  reg.GetStringValue &H80000002, "SYSTEM\CurrentControlSet\Control\Nls\CodePage", "ACP", cp
  On Error GoTo 0
  If cp = "" Then cp = "1251"
  AnsiCharset = "windows-" & cp
End Function

Sub ShowResult()
  Dim text, icon
  If removed = "" And problems = "" Then
    MsgBox T("Нечего удалять: выбранных папок и файлов уже нет."), vbInformation, "FinMaster"
    Exit Sub
  End If
  text = ""
  icon = vbInformation
  If removed <> "" Then text = T("Удалено:") & vbCrLf & removed
  If problems <> "" Then
    If text <> "" Then text = text & vbCrLf & vbCrLf
    text = text & T("Не удалось:") & vbCrLf & problems
    icon = vbExclamation
  End If
  MsgBox text, icon, "FinMaster"
End Sub

Sub AddRemoved(text)
  If removed <> "" Then removed = removed & vbCrLf
  removed = removed & ChrW(&H2022) & " " & text
End Sub

Sub AddProblem(text)
  If problems <> "" Then problems = problems & vbCrLf
  problems = problems & text
End Sub

Function HasFlag(list, name)
  HasFlag = (InStr(1, "," & LCase(list) & ",", "," & LCase(name) & ",", 1) > 0)
End Function

Function TempDir()
  Dim folder
  folder = sh.ExpandEnvironmentStrings("%TEMP%") & "\FinMaster-uninstall"
  If Not fso.FolderExists(folder) Then
    On Error Resume Next
    fso.CreateFolder folder
    On Error GoTo 0
  End If
  TempDir = folder
End Function

Function ReportsRoot()
  Dim docs
  docs = sh.SpecialFolders("MyDocuments")
  If docs = "" Then docs = sh.ExpandEnvironmentStrings("%USERPROFILE%") & "\Documents"
  ReportsRoot = docs & "\FinMaster"
End Function

Function ConfigFile()
  ConfigFile = sh.ExpandEnvironmentStrings("%APPDATA%") & "\FinMaster\config.json"
End Function

Function AppDataDir()
  AppDataDir = sh.ExpandEnvironmentStrings("%APPDATA%") & "\FinMaster"
End Function

Function IsAppDataFinMaster(path)
  Dim full, base
  full = path
  On Error Resume Next
  full = fso.GetAbsolutePathName(path)
  On Error GoTo 0
  base = sh.ExpandEnvironmentStrings("%APPDATA%")
  IsAppDataFinMaster = (Norm(fso.GetParentFolderName(full)) = Norm(base) And LCase(fso.GetFileName(full)) = "finmaster")
End Function

Function Powershell()
  Dim path
  path = sh.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
  If Not fso.FileExists(path) Then path = "powershell.exe"
  Powershell = path
End Function

Function Norm(path)
  Dim s
  s = LCase(Trim(path & ""))
  If Len(s) > 3 And Right(s, 1) = "\" Then s = Left(s, Len(s) - 1)
  Norm = s
End Function

Function Under(path, root)
  Dim a, b
  a = Norm(path)
  b = Norm(root)
  Under = False
  If a = "" Or b = "" Or a = b Then Exit Function
  If Right(b, 1) <> "\" Then b = b & "\"
  Under = (Left(a & "\", Len(b)) = b)
End Function

Function Unsafe(path)
  Dim full, windir, profile, reports
  Unsafe = True
  If path = "" Or InStr(path, """") > 0 Then Exit Function
  On Error Resume Next
  full = fso.GetAbsolutePathName(path)
  If Err.Number <> 0 Or full = "" Then
    Err.Clear
    On Error GoTo 0
    Exit Function
  End If
  On Error GoTo 0
  If Len(full) <= 3 Then Exit Function
  windir = sh.ExpandEnvironmentStrings("%WINDIR%")
  profile = sh.ExpandEnvironmentStrings("%USERPROFILE%")
  If Norm(full) = Norm(windir) Or Under(full, windir) Then Exit Function
  If Norm(full) = Norm(profile) Then Exit Function
  reports = ReportsRoot()
  If Norm(full) = Norm(reports) Or Under(full, reports) Or Under(reports, full) Then Exit Function
  If Not fso.FolderExists(full) Then Exit Function
  If Not (fso.FileExists(full & "\FinMaster.exe") Or fso.FileExists(full & "\app.py") Or fso.FileExists(full & "\run.vbs")) Then Exit Function
  If IsRepo(full) Then Exit Function
  Unsafe = False
End Function
 
Function IsRepo(path)
  IsRepo = fso.FolderExists(path & "\.git") Or fso.FileExists(path & "\.git")
End Function

Function IsNamedChild(path, name)
  Dim full
  full = path
  On Error Resume Next
  full = fso.GetAbsolutePathName(path)
  On Error GoTo 0
  IsNamedChild = (Norm(fso.GetParentFolderName(full)) = Norm(ReportsRoot()) And LCase(fso.GetFileName(full)) = LCase(name))
End Function

Function BadChars(path)
  BadChars = (InStr(path, """") > 0) Or (InStr(path, "&") > 0) Or (InStr(path, "|") > 0) Or (InStr(path, "%") > 0) Or (InStr(path, "^") > 0)
End Function

Sub CloseApp(folder)
  Dim pass, left
  For pass = 1 To 4
    left = KillMatching(folder)
    If left = 0 Then Exit Sub
    WScript.Sleep 350
  Next
End Sub

Function KillMatching(folder)
  Dim wmi, procs, proc, name, exe, cmd, dirLow, n, pid
  KillMatching = 0
  n = 0
  dirLow = Norm(folder)
  If Len(dirLow) < 12 Then Exit Function
  dirLow = dirLow & "\"
  On Error Resume Next
  Set wmi = GetObject("winmgmts:\\.\root\cimv2")
  If wmi Is Nothing Then
    On Error GoTo 0
    Exit Function
  End If
  Set procs = wmi.ExecQuery("SELECT ProcessId, Name, ExecutablePath, CommandLine FROM Win32_Process")
  If Err.Number <> 0 Then
    Err.Clear
    On Error GoTo 0
    Exit Function
  End If
  For Each proc In procs
    name = LCase(proc.Name & "")
    exe = LCase(proc.ExecutablePath & "")
    cmd = LCase(proc.CommandLine & "")
    pid = CLng(proc.ProcessId)
    If name = "finmaster.exe" And (Left(exe, Len(dirLow)) = dirLow Or InStr(cmd, dirLow) > 0) Then
      sh.Run "taskkill /PID " & pid & " /T /F", 0, True
      n = n + 1
    ElseIf (name = "python.exe" Or name = "pythonw.exe") And InStr(cmd, dirLow) > 0 Then
      sh.Run "taskkill /PID " & pid & " /T /F", 0, True
      n = n + 1
    End If
  Next
  On Error GoTo 0
  KillMatching = n
End Function

Sub RemoveFolder(path)
  On Error Resume Next
  fso.DeleteFolder path, True
  If Not fso.FolderExists(path) Then
    On Error GoTo 0
    Exit Sub
  End If
  On Error GoTo 0
  If BadChars(path) Then Exit Sub
  sh.Run "cmd /c attrib -r -s -h """ & path & "\*"" /s /d >nul 2>&1 & rmdir /s /q """ & path & """", 0, True
End Sub

Sub ScheduleDelete(path)
  Dim bat, ts
  If BadChars(path) Then
    AddProblem T("В пути есть недопустимые символы, папка не удалена: ") & path
    Exit Sub
  End If
  bat = TempDir() & "\rmdir.cmd"
  Set ts = fso.CreateTextFile(bat, True, False)
  ts.WriteLine "@echo off"
  ts.WriteLine "ping 127.0.0.1 -n 3 >nul"
  ts.WriteLine "attrib -r -s -h """ & path & "\*"" /s /d >nul 2>&1"
  ts.WriteLine "rmdir /s /q """ & path & """"
  ts.WriteLine "del /f /q ""%~f0"""
  ts.Close
  sh.Run "cmd.exe /c """ & bat & """", 0, False
End Sub

Sub RecycleNamed(path, name, title)
  If Not IsNamedChild(path, name) Then
    AddProblem T("Неверная папка: ") & path
    Exit Sub
  End If
  If Not fso.FolderExists(path) Then Exit Sub
  If RecycleOne(path) Then
    AddRemoved title
  Else
    AddProblem T("Не удалось убрать ") & title & ": " & path
  End If
End Sub

Sub RecycleReports()
  Dim root, folder, file, n, fail
  root = ReportsRoot()
  If Not fso.FolderExists(root) Then Exit Sub
  Set folder = fso.GetFolder(root)
  n = 0
  fail = 0
  For Each file In folder.Files
    If LCase(fso.GetExtensionName(file.Name)) = "fmaster" Then
      If RecycleOne(file.Path) Then
        n = n + 1
      Else
        fail = fail + 1
      End If
    End If
  Next
  If n > 0 Then AddRemoved T("Отчёты .fmaster (") & n & ")"
  If fail > 0 Then AddProblem T("Не удалось убрать отчётов: ") & fail
End Sub

Function RecycleOne(path)
  Dim code
  EnsureRecycleScript
  code = sh.Run("""" & Powershell() & """ -NoProfile -WindowStyle Hidden -File """ & TempDir() & "\recycle.ps1"" -LiteralPath """ & path & """", 0, True)
  RecycleOne = (code = 0) And (Not fso.FileExists(path)) And (Not fso.FolderExists(path))
End Function

Sub EnsureRecycleScript()
  Dim path, ts
  path = TempDir() & "\recycle.ps1"
  If fso.FileExists(path) Then Exit Sub
  Set ts = fso.CreateTextFile(path, True, False)
  ts.WriteLine "param([Parameter(Mandatory=$true)][string]$LiteralPath)"
  ts.WriteLine "$ErrorActionPreference = 'Stop'"
  ts.WriteLine "Add-Type -AssemblyName Microsoft.VisualBasic"
  ts.WriteLine "if (Test-Path -LiteralPath $LiteralPath -PathType Container) {"
  ts.WriteLine "  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($LiteralPath, 'OnlyErrorDialogs', 'SendToRecycleBin')"
  ts.WriteLine "} elseif (Test-Path -LiteralPath $LiteralPath -PathType Leaf) {"
  ts.WriteLine "  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($LiteralPath, 'OnlyErrorDialogs', 'SendToRecycleBin')"
  ts.WriteLine "} else { exit 0 }"
  ts.Close
End Sub

Sub RemoveShortcuts(folder)
  Dim places, i, path, link, target
  places = Array(sh.SpecialFolders("Desktop"), sh.SpecialFolders("Programs"))
  For i = 0 To UBound(places)
    If places(i) <> "" Then
      path = places(i) & "\FinMaster.lnk"
      If fso.FileExists(path) Then
        target = ""
        On Error Resume Next
        Set link = sh.CreateShortcut(path)
        target = link.TargetPath & ""
        On Error GoTo 0
        If target = "" Or InStr(1, LCase(target), LCase(folder), 1) > 0 Then
          On Error Resume Next
          fso.DeleteFile path, True
          On Error GoTo 0
        End If
      End If
    End If
  Next
End Sub

Sub RemoveAssociations()
  Dim reg
  On Error Resume Next
  Set reg = GetObject("winmgmts:\\.\root\default:StdRegProv")
  If reg Is Nothing Then
    On Error GoTo 0
    Exit Sub
  End If
  On Error GoTo 0
  ClearExt reg, ".fmaster", "FinMaster.Report"
  ClearExt reg, ".fbak", "FinMaster.Backup"
  ClearExt reg, ".fmwb", "FinMaster.Dictionary"
  ClearExt reg, ".fms", "FinMaster.Settings"
  DelTree reg, "Software\Classes\FinMaster.Report"
  DelTree reg, "Software\Classes\FinMaster.Backup"
  DelTree reg, "Software\Classes\FinMaster.Dictionary"
  DelTree reg, "Software\Classes\FinMaster.Settings"
  NotifyAssoc
End Sub

Sub ClearExt(reg, ext, progId)
  Dim key, def
  key = "Software\Classes\" & ext
  def = RegGet(reg, key, "")
  On Error Resume Next
  reg.DeleteValue HKCU, key & "\OpenWithProgids", progId
  On Error GoTo 0
  If LCase(def) = LCase(progId) Then DelTree reg, key
  DelTree reg, "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\" & ext
End Sub

Sub RemoveAutostart(folder)
  Dim reg, key, val
  key = "Software\Microsoft\Windows\CurrentVersion\Run"
  On Error Resume Next
  Set reg = GetObject("winmgmts:\\.\root\default:StdRegProv")
  If reg Is Nothing Then
    On Error GoTo 0
    Exit Sub
  End If
  val = RegGet(reg, key, "FinMaster")
  If val <> "" And InStr(1, LCase(val), LCase(folder), 1) > 0 Then reg.DeleteValue HKCU, key, "FinMaster"
  On Error GoTo 0
End Sub

Sub RemoveUninstallKey(folder)
  Dim reg, key, loc, cmd
  key = "Software\Microsoft\Windows\CurrentVersion\Uninstall\FinMaster"
  On Error Resume Next
  Set reg = GetObject("winmgmts:\\.\root\default:StdRegProv")
  If reg Is Nothing Then
    On Error GoTo 0
    Exit Sub
  End If
  loc = RegGet(reg, key, "InstallLocation")
  cmd = RegGet(reg, key, "UninstallString")
  If Norm(loc) = Norm(folder) Or InStr(1, LCase(cmd), LCase(folder), 1) > 0 Then DelTree reg, key
  On Error GoTo 0
End Sub

Sub RemoveServiceFiles()
  Dim dir, names, i, path
  dir = AppDataDir()
  names = Array("instance.json", "python-install.log", "requirements.scan.txt", "stdlib.scan.txt")
  For i = 0 To UBound(names)
    path = dir & "\" & names(i)
    If fso.FileExists(path) Then
      On Error Resume Next
      fso.DeleteFile path, True
      On Error GoTo 0
    End If
  Next
  path = sh.ExpandEnvironmentStrings("%TEMP%") & "\FinMaster-update.txt"
  If fso.FileExists(path) Then
    On Error Resume Next
    fso.DeleteFile path, True
    On Error GoTo 0
  End If
End Sub

Sub RegisterInstall(folder)
  Dim reg, key, cmd, host, loc, current, icon, ver
  On Error Resume Next
  If Not fso.FolderExists(folder) Then Exit Sub
  If Not fso.FileExists(folder & "\uninstall.vbs") Then Exit Sub
  Set reg = GetObject("winmgmts:\\.\root\default:StdRegProv")
  If Err.Number <> 0 Or reg Is Nothing Then Exit Sub
  key = "Software\Microsoft\Windows\CurrentVersion\Uninstall\FinMaster"
  host = sh.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\wscript.exe"
  If Not fso.FileExists(host) Then host = "wscript.exe"
  cmd = """" & host & """ //nologo """ & folder & "\uninstall.vbs"""
  loc = RegGet(reg, key, "InstallLocation")
  current = RegGet(reg, key, "UninstallString")
  If Norm(loc) = Norm(folder) And LCase(current) = LCase(cmd) Then Exit Sub
  reg.CreateKey HKCU, key
  reg.SetStringValue HKCU, key, "DisplayName", "FinMaster"
  reg.SetStringValue HKCU, key, "Publisher", "FinMaster"
  reg.SetStringValue HKCU, key, "InstallLocation", folder
  reg.SetStringValue HKCU, key, "UninstallString", cmd
  If fso.FileExists(folder & "\FinMaster.exe") Then
    icon = """" & folder & "\FinMaster.exe"",0"
    reg.SetStringValue HKCU, key, "DisplayIcon", icon
  ElseIf fso.FileExists(folder & "\frontend\favicon.ico") Then
    reg.SetStringValue HKCU, key, "DisplayIcon", folder & "\frontend\favicon.ico"
  End If
  ver = CommitVersion()
  If ver <> "" Then reg.SetStringValue HKCU, key, "DisplayVersion", ver
  reg.SetDWORDValue HKCU, key, "NoModify", 1
  reg.SetDWORDValue HKCU, key, "NoRepair", 1
End Sub

Function CommitVersion()
  Dim text, p, tail, i, ch, ver
  CommitVersion = ""
  If Not fso.FileExists(ConfigFile()) Then Exit Function
  text = ReadUtf8(ConfigFile())
  p = InStr(1, text, """install_commit""", 1)
  If p = 0 Then Exit Function
  tail = Mid(text, p, 90)
  p = InStr(tail, ":")
  If p = 0 Then Exit Function
  tail = Mid(tail, p + 1)
  p = InStr(tail, """")
  If p = 0 Then Exit Function
  tail = Mid(tail, p + 1)
  p = InStr(tail, """")
  If p <= 1 Then Exit Function
  ver = Left(tail, p - 1)
  If Len(ver) < 7 Then Exit Function
  For i = 1 To 7
    ch = LCase(Mid(ver, i, 1))
    If InStr("0123456789abcdef", ch) = 0 Then Exit Function
  Next
  CommitVersion = Left(ver, 7)
End Function

Function RegGet(reg, key, name)
  Dim value
  value = ""
  On Error Resume Next
  reg.GetStringValue HKCU, key, name, value
  On Error GoTo 0
  RegGet = value & ""
End Function

Sub DelTree(reg, key)
  Dim names, i
  On Error Resume Next
  names = Empty
  reg.EnumKey HKCU, key, names
  If IsArray(names) Then
    For i = 0 To UBound(names)
      DelTree reg, key & "\" & names(i)
    Next
  End If
  reg.DeleteKey HKCU, key
  On Error GoTo 0
End Sub

Sub NotifyAssoc()
  Dim path, ts
  path = TempDir() & "\notify.ps1"
  On Error Resume Next
  Set ts = fso.CreateTextFile(path, True, False)
  If Err.Number <> 0 Then
    Err.Clear
    On Error GoTo 0
    Exit Sub
  End If
  ts.WriteLine "Add-Type -Name FmSh -Namespace Fm -MemberDefinition @"""
  ts.WriteLine "[DllImport(""shell32.dll"")] public static extern void SHChangeNotify(int w, uint f, IntPtr a, IntPtr b);"
  ts.WriteLine """@"
  ts.WriteLine "[Fm.FmSh]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)"
  ts.Close
  On Error GoTo 0
  sh.Run """" & Powershell() & """ -NoProfile -WindowStyle Hidden -File """ & path & """", 0, True
End Sub

Sub PatchConfig(path, clearInstall, clearPython)
  Dim text, nextText
  On Error Resume Next
  text = ReadUtf8(path)
  If Err.Number <> 0 Or text = "" Then
    Err.Clear
    On Error GoTo 0
    AddProblem T("Не удалось обновить файл конфигурации.")
    Exit Sub
  End If
  nextText = PatchText(text, clearInstall, clearPython)
  WriteUtf8NoBom path, nextText
  If Err.Number <> 0 Then
    Err.Clear
    AddProblem T("Не удалось обновить файл конфигурации.")
  End If
  On Error GoTo 0
End Sub

Function PatchText(text, clearInstall, clearPython)
  Dim lines, i, line, crlf
  crlf = (InStr(text, vbCrLf) > 0)
  lines = Split(Replace(text, vbCrLf, vbLf), vbLf)
  For i = 0 To UBound(lines)
    line = lines(i)
    If clearInstall Then
      If LineKey(line, "installed") Or LineKey(line, "update_pending") Then
        line = SetJsonBool(line, "false")
      ElseIf LineKey(line, "install_path") Or LineKey(line, "install_commit") Then
        line = SetJsonString(line, "")
      End If
    End If
    If clearPython And LineKey(line, "python_place") Then line = SetJsonString(line, "")
    lines(i) = line
  Next
  If crlf Then
    PatchText = Join(lines, vbCrLf)
  Else
    PatchText = Join(lines, vbLf)
  End If
End Function

Function LineKey(line, key)
  Dim s
  s = LTrim(line)
  LineKey = (Left(s, Len(key) + 2) = """" & key & """")
End Function

Function SetJsonBool(line, value)
  Dim p, comma
  p = InStr(line, ":")
  If p = 0 Then
    SetJsonBool = line
    Exit Function
  End If
  comma = ""
  If Right(RTrim(line), 1) = "," Then comma = ","
  SetJsonBool = Left(line, p) & " " & value & comma
End Function

Function SetJsonString(line, value)
  Dim p, comma
  p = InStr(line, ":")
  If p = 0 Then
    SetJsonString = line
    Exit Function
  End If
  comma = ""
  If Right(RTrim(line), 1) = "," Then comma = ","
  SetJsonString = Left(line, p) & " """ & value & """" & comma
End Function

Function ReadUtf8(path)
  Dim stream
  ReadUtf8 = ""
  Set stream = CreateObject("ADODB.Stream")
  stream.Type = 2
  stream.Charset = "utf-8"
  stream.Open
  stream.LoadFromFile path
  ReadUtf8 = stream.ReadText(-1)
  stream.Close
End Function

Sub WriteUtf8NoBom(path, text)
  Dim textStream, bin
  Set textStream = CreateObject("ADODB.Stream")
  textStream.Type = 2
  textStream.Charset = "utf-8"
  textStream.Open
  textStream.WriteText text
  textStream.Position = 0
  textStream.Type = 1
  textStream.Position = 3
  Set bin = CreateObject("ADODB.Stream")
  bin.Type = 1
  bin.Open
  textStream.CopyTo bin
  bin.SaveToFile path, 2
  bin.Close
  textStream.Close
End Sub
