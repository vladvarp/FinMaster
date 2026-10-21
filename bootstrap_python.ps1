# Устанавливает Python в Документы\FinMaster\python (или в -PythonDir) и библиотеки из requirements.txt.
# Архив — официальный embeddable с python.org, без записи в «Программы и компоненты».
param(
  [string]$Requirements = "",
  [string]$Stdlib = "",
  [string]$PythonDir = "",
  [switch]$Plan
)

$ErrorActionPreference = "Stop"
$PyVersion = "3.12.10"

function Get-FinMasterRoot {
  $docs = [Environment]::GetFolderPath("MyDocuments")
  if (-not $docs) { throw "Не найдена папка Документы" }
  return (Join-Path $docs "FinMaster")
}

function Get-InstallStateDir {
  $base = [Environment]::GetFolderPath("ApplicationData")
  if (-not $base) { $base = Join-Path $env:USERPROFILE "AppData\Roaming" }
  $dir = Join-Path $base "FinMaster"
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  return $dir
}

function Write-Log([string]$Message) {
  $line = (Get-Date -Format "HH:mm:ss") + " " + $Message
  Add-Content -LiteralPath $script:LogFile -Value $line -Encoding UTF8
  Write-Host $line
}

function Invoke-Logged([string]$File, [string]$Arguments) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $File
  $psi.Arguments = $Arguments
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $utf8 = New-Object System.Text.UTF8Encoding $false
  $psi.StandardOutputEncoding = $utf8
  $psi.StandardErrorEncoding = $utf8
  try { $psi.EnvironmentVariables["PYTHONUNBUFFERED"] = "1" } catch {}
  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi
  $logPath = $script:LogFile
  $action = {
    $line = [string]$EventArgs.Data
    if ([string]::IsNullOrWhiteSpace($line)) { return }
    $stamp = (Get-Date -Format "HH:mm:ss") + " " + $line.Trim() + "`r`n"
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [IO.File]::AppendAllText([string]$event.MessageData, $stamp, $utf8)
  }
  $subOut = Register-ObjectEvent -InputObject $proc -EventName OutputDataReceived -MessageData $logPath -Action $action
  $subErr = Register-ObjectEvent -InputObject $proc -EventName ErrorDataReceived -MessageData $logPath -Action $action
  [void]$proc.Start()
  $proc.BeginOutputReadLine()
  $proc.BeginErrorReadLine()
  $proc.WaitForExit()
  $proc.WaitForExit(1000) | Out-Null
  Unregister-Event -SourceIdentifier $subOut.Name -ErrorAction SilentlyContinue
  Unregister-Event -SourceIdentifier $subErr.Name -ErrorAction SilentlyContinue
  return $proc.ExitCode
}

function Get-PyArch {
  $arch = $env:PROCESSOR_ARCHITECTURE
  if ($env:PROCESSOR_ARCHITEW6432) { $arch = $env:PROCESSOR_ARCHITEW6432 }
  switch ($arch) {
    "AMD64" { return "amd64" }
    "ARM64" { return "arm64" }
    "x86" { return "win32" }
    default { throw "Архитектура процессора не поддерживается: $arch" }
  }
}

function Save-Official([string]$Url, [string]$OutFile, [string[]]$Hosts, [long]$MinBytes, [long]$MaxBytes) {
  $uri = [Uri]$Url
  if ($Hosts -notcontains $uri.Host) { throw "Недопустимый адрес загрузки" }
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $request = [Net.HttpWebRequest]::Create($Url)
  $request.AllowAutoRedirect = $true
  $request.MaximumAutomaticRedirections = 3
  $request.UserAgent = "FinMaster"
  $request.Timeout = 180000
  $response = $request.GetResponse()
  try {
    if ($Hosts -notcontains $response.ResponseUri.Host) { throw "Загрузка ушла на незнакомый адрес" }
    $stream = $response.GetResponseStream()
    $file = [IO.File]::Create($OutFile)
    try { $stream.CopyTo($file) } finally { $file.Close() }
  } finally {
    $response.Close()
  }
  $len = (Get-Item -LiteralPath $OutFile).Length
  if ($len -lt $MinBytes -or $len -gt $MaxBytes) { throw "Неожиданный размер скачанного файла" }
}

function Assert-Zip([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  try {
    $b0 = $stream.ReadByte()
    $b1 = $stream.ReadByte()
  } finally { $stream.Close() }
  if ($b0 -ne 0x50 -or $b1 -ne 0x4B) { throw "Скачанный архив Python повреждён" }
}

function Expand-SafeZip([string]$ZipPath, [string]$Destination) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $root = [IO.Path]::GetFullPath($Destination)
  if (-not $root.EndsWith([IO.Path]::DirectorySeparatorChar)) {
    $root = $root + [IO.Path]::DirectorySeparatorChar
  }
  $archive = [IO.Compression.ZipFile]::OpenRead($ZipPath)
  try {
    foreach ($entry in $archive.Entries) {
      $name = ($entry.FullName -replace '/', '\')
      if ($name.StartsWith('\') -or $name.Contains('..')) { throw "Архив Python отклонён" }
      $target = [IO.Path]::GetFullPath((Join-Path $Destination $entry.FullName))
      $same = $target.Equals($root.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)
      if (-not $same -and -not $target.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Архив Python отклонён"
      }
    }
  } finally {
    $archive.Dispose()
  }
  Expand-Archive -LiteralPath $ZipPath -DestinationPath $Destination -Force
}

function Repair-PythonPath([string]$Destination) {
  $pth = Get-ChildItem -LiteralPath $Destination -Filter "python*._pth" | Select-Object -First 1
  if (-not $pth) { throw "В комплекте Python нет файла ._pth" }
  $text = [IO.File]::ReadAllText($pth.FullName)
  $text = [regex]::Replace($text, '(?m)^#\s*import site\s*$', 'import site')
  if ($text -notmatch '(?m)^import site\s*$') { $text = $text.TrimEnd() + "`r`nimport site`r`n" }
  if ($text -notmatch '(?m)^Lib\\site-packages\s*$') { $text = $text.TrimEnd() + "`r`nLib\site-packages`r`n" }
  if ($text -notmatch '(?m)^Lib\s*$') { $text = $text.TrimEnd() + "`r`nLib`r`n" }
  [IO.File]::WriteAllText($pth.FullName, $text)
  New-Item -ItemType Directory -Force -Path (Join-Path $Destination "Lib\site-packages") | Out-Null
}

function Get-StdlibNames([string]$Path) {
  $names = New-Object System.Collections.Generic.List[string]
  if ($Path -and (Test-Path -LiteralPath $Path)) {
    foreach ($line in [IO.File]::ReadAllLines($Path)) {
      $name = $line.Trim().ToLower()
      if ($name -match '^[a-z_][a-z0-9_]{0,40}$' -and -not $names.Contains($name)) {
        [void]$names.Add($name)
      }
    }
  }
  if (-not $names.Contains("tkinter")) { [void]$names.Add("tkinter") }
  return $names
}

function Get-MissingModules([string]$Python, [string[]]$Names) {
  $safe = @()
  foreach ($name in $Names) {
    if ($name -match '^[a-z_][a-z0-9_]{0,40}$') { $safe += $name }
  }
  if ($safe.Count -eq 0) { return @() }
  $joined = ($safe | ForEach-Object { "'$_'" }) -join ","
  $py = Join-Path ([IO.Path]::GetTempPath()) ("finmaster-mods-" + [guid]::NewGuid().ToString("n") + ".py")
  $code = @"
import json
names = [$joined]
missing = []
for name in names:
    try:
        __import__(name)
    except Exception:
        missing.append(name)
print(json.dumps(missing))
"@
  [IO.File]::WriteAllText($py, $code)
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $Python
  $psi.Arguments = "`"$py`""
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi
  try {
    [void]$proc.Start()
    $text = $proc.StandardOutput.ReadToEnd()
    $proc.WaitForExit()
  } finally {
    Remove-Item -LiteralPath $py -Force -ErrorAction SilentlyContinue
  }
  if ($proc.ExitCode -ne 0 -or -not $text.Trim()) { return @($safe) }
  $parsed = ConvertFrom-Json $text.Trim()
  if ($null -eq $parsed) { return @() }
  return @($parsed)
}

function Expand-Msi([string]$Msi, [string]$Dest) {
  if (Test-Path -LiteralPath $Dest) { Remove-Item -LiteralPath $Dest -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $Dest | Out-Null
  $proc = Start-Process -FilePath "$env:SystemRoot\System32\msiexec.exe" -ArgumentList @("/a", $Msi, "/qn", "TARGETDIR=$Dest") -Wait -PassThru -WindowStyle Hidden
  if ($proc.ExitCode -ne 0) { throw "Не удалось распаковать компонент Python" }
}

function Copy-StdlibModule([string]$Extracted, [string]$Destination, [string]$Name) {
  $dir = Join-Path $Extracted "Lib\$Name"
  $file = Join-Path $Extracted "Lib\$Name.py"
  New-Item -ItemType Directory -Force -Path (Join-Path $Destination "Lib") | Out-Null
  if (Test-Path -LiteralPath $dir) {
    $target = Join-Path $Destination "Lib\$Name"
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
    Copy-Item -LiteralPath $dir -Destination $target -Recurse -Force
    return
  }
  if (Test-Path -LiteralPath $file) {
    Copy-Item -LiteralPath $file -Destination (Join-Path $Destination "Lib") -Force
    return
  }
  throw "В комплекте Python нет встроенного модуля $Name"
}

function Install-StdlibGaps([string]$Destination, [string]$Arch, [string[]]$Names) {
  $python = Join-Path $Destination "python.exe"
  $missing = @(Get-MissingModules $python $Names)
  if ($missing.Count -eq 0) {
    Write-Log "Встроенные библиотеки на месте"
    return
  }
  Write-Log ("Не хватает встроенных: " + ($missing -join ", "))
  $folder = @{ amd64 = "amd64"; arm64 = "arm64"; win32 = "win32" }[$Arch]
  if (-not $folder) { throw "Нет встроенных библиотек для этой архитектуры" }
  $base = "https://www.python.org/ftp/python/$PyVersion/$folder"
  $work = Join-Path ([IO.Path]::GetTempPath()) ("finmaster-stdlib-" + [guid]::NewGuid().ToString("n"))
  New-Item -ItemType Directory -Force -Path $work | Out-Null
  try {
    $tkMods = @("tkinter", "turtle", "idlelib", "turtledemo")
    $needTk = $false
    foreach ($name in $missing) { if ($tkMods -contains $name) { $needTk = $true } }
    if ($needTk) {
      $msi = Join-Path $work "tcltk.msi"
      Write-Log "Скачиваю tkinter с python.org"
      Save-Official "$base/tcltk.msi" $msi @("www.python.org") 500000 20000000
      $ext = Join-Path $work "tcltk"
      Write-Log "Распаковываю tkinter"
      Expand-Msi $msi $ext
      Copy-Item (Join-Path $ext "DLLs\*") $Destination -Force
      $tclDest = Join-Path $Destination "tcl"
      if (Test-Path -LiteralPath $tclDest) { Remove-Item -LiteralPath $tclDest -Recurse -Force }
      Copy-Item (Join-Path $ext "tcl") $tclDest -Recurse -Force
      foreach ($name in $missing) {
        if ($tkMods -contains $name) { Copy-StdlibModule $ext $Destination $name }
      }
    }
    $others = @($missing | Where-Object { $tkMods -notcontains $_ })
    if ($others.Count -gt 0) {
      $msi = Join-Path $work "lib.msi"
      Write-Log "Скачиваю встроенные библиотеки с python.org"
      Save-Official "$base/lib.msi" $msi @("www.python.org") 1000000 40000000
      $ext = Join-Path $work "lib"
      Write-Log "Распаковываю встроенные библиотеки"
      Expand-Msi $msi $ext
      foreach ($name in $others) {
        Copy-StdlibModule $ext $Destination $name
        Write-Log "Дописал встроенный модуль $name"
      }
    }
    $still = @(Get-MissingModules $python $missing)
    if ($still.Count -gt 0) { throw ("Модуль так и не заработал: " + ($still -join ", ")) }
    Write-Log "Встроенные библиотеки дописаны"
  } finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  }
}

$root = Get-FinMasterRoot
$dest = Join-Path $root "python"
if ($PythonDir) {
  $PythonDir = [IO.Path]::GetFullPath($PythonDir)
  $docsPy = [IO.Path]::GetFullPath((Join-Path $root "python"))
  $leaf = Split-Path -Leaf $PythonDir
  $parent = Split-Path -Parent $PythonDir
  $beside = ($leaf -eq "python") -and (Test-Path -LiteralPath (Join-Path $parent "app.py")) -and (Test-Path -LiteralPath (Join-Path $parent "run.vbs"))
  $inDocs = ($PythonDir.TrimEnd('\') -ieq $docsPy.TrimEnd('\'))
  if (-not $beside -and -not $inDocs) { throw "Недопустимая папка Python" }
  $dest = $PythonDir
}
$stateDir = Get-InstallStateDir
$script:LogFile = Join-Path $stateDir "python-install.log"
New-Item -ItemType Directory -Force -Path $root | Out-Null
Set-Content -LiteralPath $script:LogFile -Value "" -Encoding UTF8

try {
  $Host.UI.RawUI.WindowTitle = "FinMaster — установка Python"
} catch {}

try {
  if (-not $Requirements) { $Requirements = Join-Path $PSScriptRoot "requirements.txt" }
  $Requirements = [IO.Path]::GetFullPath($Requirements)
  $reqName = [IO.Path]::GetFileName($Requirements)
  $docsRoot = [IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
  $stateRoot = [IO.Path]::GetFullPath($stateDir).TrimEnd('\') + '\'
  $scriptRoot = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') + '\'
  $inDocs = $Requirements.StartsWith($docsRoot, [StringComparison]::OrdinalIgnoreCase)
  $inState = $Requirements.StartsWith($stateRoot, [StringComparison]::OrdinalIgnoreCase)
  $inScript = $Requirements.StartsWith($scriptRoot, [StringComparison]::OrdinalIgnoreCase)
  $listOk = ($reqName -eq "requirements.txt" -and $inScript) -or ($reqName -eq "requirements.scan.txt" -and ($inDocs -or $inState))
  if (-not $listOk) { throw "Ожидался список библиотек программы" }
  if (-not (Test-Path -LiteralPath $Requirements)) { throw "Не найден список библиотек" }
  if ($Stdlib) {
    $Stdlib = [IO.Path]::GetFullPath($Stdlib)
    $stdName = [IO.Path]::GetFileName($Stdlib)
    $stdInDocs = $Stdlib.StartsWith($docsRoot, [StringComparison]::OrdinalIgnoreCase)
    $stdInState = $Stdlib.StartsWith($stateRoot, [StringComparison]::OrdinalIgnoreCase)
    if ($stdName -ne "stdlib.scan.txt" -or -not ($stdInDocs -or $stdInState)) { throw "Ожидался список встроенных библиотек программы" }
  }

  $arch = Get-PyArch
  $url = "https://www.python.org/ftp/python/$PyVersion/python-$PyVersion-embed-$arch.zip"
  Write-Log "Папка: $dest"
  Write-Log "Архив: $url"
  if ($Plan) { exit 0 }

  $pythonExe = Join-Path $dest "python.exe"
  if (-not (Test-Path -LiteralPath $pythonExe)) {
    if (Test-Path -LiteralPath $dest) {
      Write-Log "Удаляю неполную установку"
      Remove-Item -LiteralPath $dest -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    $zip = Join-Path ([IO.Path]::GetTempPath()) ("finmaster-python-" + [guid]::NewGuid().ToString("n") + ".zip")
    Write-Log "Скачиваю Python $PyVersion"
    Save-Official $url $zip @("www.python.org") 5000000 40000000
    Assert-Zip $zip
    Write-Log "Распаковываю"
    Expand-SafeZip $zip $dest
    Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
  } else {
    Write-Log "Python уже лежит в папке FinMaster"
  }

  $pythonExe = Join-Path $dest "python.exe"
  $pythonW = Join-Path $dest "pythonw.exe"
  if (-not (Test-Path -LiteralPath $pythonExe)) { throw "python.exe не появился после распаковки" }
  if (-not (Test-Path -LiteralPath $pythonW)) { throw "pythonw.exe не появился после распаковки" }
  Repair-PythonPath $dest
  $stdNames = @(Get-StdlibNames $Stdlib)
  Install-StdlibGaps $dest $arch $stdNames

  Write-Log "Проверяю, установлен ли pip"
  $pipCode = Invoke-Logged $pythonExe "-u -m pip --version"
  if ($pipCode -ne 0) {
    $pipScript = Join-Path ([IO.Path]::GetTempPath()) ("finmaster-get-pip-" + [guid]::NewGuid().ToString("n") + ".py")
    Write-Log "Скачиваю установщик pip с bootstrap.pypa.io"
    Save-Official "https://bootstrap.pypa.io/get-pip.py" $pipScript @("bootstrap.pypa.io") 100000 5000000
    $head = [IO.File]::ReadAllText($pipScript).Substring(0, [Math]::Min(80, (Get-Item $pipScript).Length))
    if ($head.TrimStart().StartsWith("<")) { throw "Вместо pip скачалась веб-страница" }
    $pipCode = Invoke-Logged $pythonExe "-u `"$pipScript`""
    Remove-Item -LiteralPath $pipScript -Force -ErrorAction SilentlyContinue
    if ($pipCode -ne 0) { throw "Не удалось установить pip" }
  }

  Write-Log "Ставлю setuptools и wheel, чтобы собрать пакеты без отдельного окружения"
  $toolCode = Invoke-Logged $pythonExe "-u -m pip install --disable-pip-version-check --progress-bar off --no-warn-script-location setuptools wheel"
  if ($toolCode -ne 0) { throw "Не удалось подготовить установщик библиотек" }
  Write-Log "Ставлю библиотеки, которые нашёл в файлах программы"
  $libCode = Invoke-Logged $pythonExe "-u -m pip install --disable-pip-version-check --progress-bar off --no-warn-script-location --no-build-isolation -r `"$Requirements`""
  if ($libCode -ne 0) { throw "Не удалось установить библиотеки. Проверьте интернет." }
  Write-Log "Готово"
  exit 0
} catch {
  Write-Log ("Ошибка: " + $_.Exception.Message)
  exit 1
}
