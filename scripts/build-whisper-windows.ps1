param(
  [string]$WhisperSource = (Join-Path (Split-Path $PSScriptRoot -Parent) 'whisper.cpp')
)

$ErrorActionPreference = 'Stop'
$commit = 'a630b35c6fc02c8879f751ec3f39a61327f01dc7'
$repo = 'https://github.com/ggml-org/whisper.cpp.git'
$ledgerRoot = Split-Path $PSScriptRoot -Parent
$buildDir = Join-Path $ledgerRoot '.build\whisper-windows'
$output = Join-Path $ledgerRoot 'native\whisper-cli.exe'
$serverOutput = Join-Path $ledgerRoot 'native\whisper-server.exe'

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw 'Git is required to build the Windows Whisper runtime.'
}
$cmakeCommand = Get-Command cmake -ErrorAction SilentlyContinue | Select-Object -First 1
$cmakePath = if ($cmakeCommand) { $cmakeCommand.Source } else {
  @(
    (Join-Path $env:ProgramFiles 'CMake\bin\cmake.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'CMake\bin\cmake.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\CMake\bin\cmake.exe')
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $cmakePath) {
  throw 'CMake is required to build the Windows Whisper runtime. Close and reopen PowerShell after installing CMake, or add its bin folder to PATH.'
}

if (-not (Test-Path (Join-Path $WhisperSource '.git'))) {
  git clone $repo $WhisperSource
}

git -C $WhisperSource fetch --tags origin
git -C $WhisperSource checkout --force $commit

Write-Host "Configuring pinned Whisper runtime in $buildDir..."
& $cmakePath -S $WhisperSource -B $buildDir `
  -DWHISPER_BUILD_TESTS=OFF `
  -DWHISPER_BUILD_EXAMPLES=ON `
  -DWHISPER_BUILD_SERVER=ON `
  -DGGML_NATIVE=OFF `
  -DBUILD_SHARED_LIBS=OFF
Write-Host 'Building whisper-cli.exe (the first build may take several minutes)...'
& $cmakePath --build $buildDir --config Release --target whisper-cli --parallel
& $cmakePath --build $buildDir --config Release --target whisper-server --parallel

$built = Get-ChildItem -Path $buildDir -Recurse -Filter 'whisper-cli.exe' -File | Select-Object -First 1
if (-not $built) {
  throw "CMake completed but whisper-cli.exe was not found under $buildDir."
}
$builtServer = Get-ChildItem -Path $buildDir -Recurse -Filter 'whisper-server.exe' -File | Select-Object -First 1
if (-not $builtServer) {
  throw "CMake completed but whisper-server.exe was not found under $buildDir."
}

New-Item -ItemType Directory -Force (Split-Path $output -Parent) | Out-Null
Copy-Item $built.FullName $output -Force
Copy-Item $builtServer.FullName $serverOutput -Force
Write-Host "Windows Whisper runtimes ready: $output and $serverOutput"
