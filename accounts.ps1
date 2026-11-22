# Local authentication and private file storage, outside the web root.
param([int]$Port = 8090, [int]$WebPort = 8080)
$ErrorActionPreference = 'Stop'
$version = '0.40.6'
$storage = Join-Path $env:LOCALAPPDATA 'PogodaVnutri'
$bin = Join-Path $storage "pocketbase-$version"
$exe = Join-Path $bin 'pocketbase.exe'
if (!(Test-Path -LiteralPath $exe)) {
  New-Item -ItemType Directory -Force -Path $bin | Out-Null
  $zip = Join-Path $bin 'windows_amd64.zip'
  Invoke-WebRequest -UseBasicParsing "https://github.com/pocketbase/pocketbase/releases/download/v$version/pocketbase_${version}_windows_amd64.zip" -OutFile $zip
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash -ne '33a2a1d255cadded77346fc7f5de37dca21ba4bad0d9cae0235a50b3b703d6d9') {
    throw 'Invalid PocketBase archive checksum.'
  }
  Expand-Archive -LiteralPath $zip -DestinationPath $bin -Force
}
$data = Join-Path $storage 'data'
$migrations = Join-Path $PSScriptRoot 'pb_migrations'
$hooks = Join-Path $PSScriptRoot 'pb_hooks'
$parameters = @('serve', "--http=127.0.0.1:$Port", "--dir=`"$data`"", "--migrationsDir=`"$migrations`"", "--hooksDir=`"$hooks`"", '--automigrate=false', "--origins=http://localhost:$WebPort,http://127.0.0.1:$WebPort")
Start-Process -FilePath $exe -ArgumentList $parameters -WorkingDirectory $storage -WindowStyle Hidden
