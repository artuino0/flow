<#
.SYNOPSIS
  Despliega una rama o commit al ambiente de QA local (ERD-92).

.DESCRIPTION
  El ambiente de QA vive en un git worktree hermano (..\frontback-qa), con su propio
  .env (puerto 3100, base erp_dinamico_qa), su propio .nuxt/.output y un build de
  producción sin hot reload. Así el servidor de desarrollo (npm run dev, :3000) no se
  toca al compilar ni al probar.

  Pasos: detener QA -> checkout del ref -> npm ci si cambió package-lock -> migrar la
  base de QA -> build -> arrancar en :3100 -> esperar /api/health.

  Preparación única (ya hecha la primera vez):
    git worktree add --detach ..\frontback-qa HEAD
    copiar .env y cambiar la base a erp_dinamico_qa, APP_BASE_URL y PORT/NITRO_PORT a 3100

.PARAMETER Ref
  Rama, tag o commit a desplegar (por defecto la rama actual de frontback).

.PARAMETER ResetDb
  Recrea erp_dinamico_qa como copia de la base de desarrollo (erp_dinamico) antes de migrar.

.PARAMETER Stop
  Solo detiene el servidor de QA.

.EXAMPLE
  .\scripts\qa-deploy.ps1 BUG-ERD-91
  .\scripts\qa-deploy.ps1 -ResetDb
  .\scripts\qa-deploy.ps1 -Stop
#>
param(
  [string]$Ref,
  [switch]$ResetDb,
  [switch]$Stop,
  [int]$Port = 3100,
  [string]$DbContainer = 'erp-dinamico-db'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$qa = Join-Path (Split-Path -Parent $root) 'frontback-qa'
$pidFile = Join-Path $qa '.qa-pid'
$logFile = Join-Path $qa 'qa-server.log'

function Stop-Qa {
  $pids = [System.Collections.Generic.HashSet[int]]::new()
  if (Test-Path $pidFile) {
    $savedPid = 0
    if ([int]::TryParse((Get-Content -Raw $pidFile).Trim(), [ref]$savedPid) -and
        (Get-Process -Id $savedPid -ErrorAction SilentlyContinue)) {
      [void]$pids.Add($savedPid)
    }
  }

  $connections = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  foreach ($connection in $connections) {
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($connection.OwningProcess)"
    if ($owner.CommandLine -match '\.output[\\/]server[\\/]index\.mjs') {
      [void]$pids.Add([int]$connection.OwningProcess)
    } else {
      throw "El puerto $Port está ocupado por PID $($connection.OwningProcess), que no parece ser el servidor QA (.output/server/index.mjs). No se detuvo."
    }
  }

  foreach ($processId in $pids) {
    if (Get-Process -Id $processId -ErrorAction SilentlyContinue) {
      Stop-Process -Id $processId -Force
      Write-Host "QA detenido (PID $processId)"
    }
  }

  if (Test-Path $pidFile) { Remove-Item $pidFile -Force }
  $deadline = (Get-Date).AddSeconds(15)
  do {
    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    if (-not $listeners) { return }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  throw "El puerto $Port sigue ocupado después de esperar 15 segundos."
}

if (-not (Test-Path (Join-Path $qa '.env'))) { throw "No existe $qa\.env. Haz la preparación única descrita en el encabezado del script." }

Stop-Qa
if ($Stop) { return }

if (-not $Ref) { $Ref = (git -C $root rev-parse --abbrev-ref HEAD).Trim() }
$lockBefore = (Get-FileHash (Join-Path $qa 'package-lock.json')).Hash
git -C $qa checkout --detach $Ref
if ($LASTEXITCODE -ne 0) { throw "No se pudo hacer checkout de $Ref en QA" }
$commit = (git -C $qa log --oneline -1).Trim()
Write-Host "QA en $commit"

Push-Location $qa
try {
  $lockAfter = (Get-FileHash 'package-lock.json').Hash
  if ($lockBefore -ne $lockAfter -or -not (Test-Path 'node_modules')) {
    Write-Host 'package-lock cambió: npm ci'
    npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm ci falló' }
  }

  if ($ResetDb) {
    Write-Host 'Recreando erp_dinamico_qa desde erp_dinamico'
    docker exec $DbContainer dropdb -U erp_admin --if-exists erp_dinamico_qa
    docker exec $DbContainer createdb -U erp_admin -O erp_admin erp_dinamico_qa
    docker exec $DbContainer sh -c 'pg_dump -U erp_admin erp_dinamico | psql -q -U erp_admin -d erp_dinamico_qa -v ON_ERROR_STOP=1' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'La copia de la base falló' }
  }

  # drizzle.config.ts carga el .env de esta carpeta: migra erp_dinamico_qa, nunca la de desarrollo.
  npx drizzle-kit migrate
  if ($LASTEXITCODE -ne 0) { throw 'Las migraciones de QA fallaron' }

  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'El build de QA falló' }

  $proc = Start-Process -FilePath 'node' -ArgumentList '--env-file=.env', '.output/server/index.mjs' `
    -WorkingDirectory $qa -RedirectStandardOutput $logFile -RedirectStandardError "$logFile.err" -WindowStyle Hidden -PassThru
  $proc.Id | Set-Content $pidFile
  Start-Sleep -Seconds 2
  $proc.Refresh()
  if ($proc.HasExited) {
    $errTail = if (Test-Path "$logFile.err") { (Get-Content "$logFile.err" -Tail 20) -join "`n" } else { '(qa-server.log.err no existe)' }
    throw "El servidor QA terminó al arrancar (código $($proc.ExitCode)). Últimas líneas de qa-server.log.err:`n$errTail"
  }
} finally {
  Pop-Location
}

$url = "http://localhost:$Port/api/health"
for ($i = 0; $i -lt 60; $i++) {
  try {
    $res = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
    if ($res.StatusCode -eq 200) { Write-Host "QA listo en http://localhost:$Port ($commit)"; exit 0 }
  } catch { Start-Sleep -Seconds 2 }
}
throw "QA no respondió en $url. Revisa $logFile y $logFile.err"
