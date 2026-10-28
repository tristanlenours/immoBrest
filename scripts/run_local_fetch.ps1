# Fetch quotidien de Leboncoin (qui bloque les IP de datacenter), puis mise à jour du site.
# Human est en pause : son site répond 403 aux scrapers, y compris depuis ce PC.
# Lancé par la tâche planifiée « ImmoBrest - Fetch Leboncoin » (voir install_local_task.ps1).
#
# Usage manuel :
#   powershell -File scripts\run_local_fetch.ps1            # exécution complète
#   powershell -File scripts\run_local_fetch.ps1 -DryRun    # scrape sans rien écrire (base, git)

param([switch]$DryRun)

# Continue : git écrit sa progression sur stderr, ce que « Stop » traiterait comme une erreur.
$ErrorActionPreference = 'Continue'

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force $logDir | Out-Null
Get-ChildItem $logDir -Filter 'local_fetch_*.log' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force
Start-Transcript -Path (Join-Path $logDir ('local_fetch_{0:yyyyMMdd_HHmmss}.log' -f (Get-Date))) | Out-Null

function Invoke-Native([string]$Exe, [string[]]$Arguments) {
  & $Exe @Arguments 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "$Exe $($Arguments -join ' ') a échoué (code $LASTEXITCODE)"
  }
}

function Test-DebugPort {
  try {
    Invoke-WebRequest -Uri 'http://127.0.0.1:9222/json/version' -UseBasicParsing -TimeoutSec 2 | Out-Null
    return $true
  } catch {
    return $false
  }
}

$failed = $false
$startedChrome = $null

try {
  Write-Host "=== Fetch local ImmoBrest $(Get-Date -Format 'yyyy-MM-dd HH:mm') $(if ($DryRun) { '(DRY-RUN)' }) ==="

  # 1. Chrome en mode debug (profil dédié, connecté à Leboncoin)
  if (-not (Test-DebugPort)) {
    $chrome = @(
      "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
      "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
      "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $chrome) { throw 'Chrome introuvable.' }

    $profileDir = Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data\TempProfile'
    Write-Host 'Démarrage de Chrome en mode debug...'
    $startedChrome = Start-Process $chrome -ArgumentList '--remote-debugging-port=9222', "--user-data-dir=`"$profileDir`"" -PassThru

    $ready = $false
    for ($i = 0; $i -lt 30 -and -not $ready; $i++) {
      Start-Sleep -Seconds 1
      $ready = Test-DebugPort
    }
    if (-not $ready) { throw "Chrome n'expose pas le port 9222 (le profil TempProfile est peut-être déjà ouvert sans mode debug)." }
  }

  # 2. Récupérer les commits du cloud avant de travailler
  if (-not $DryRun) {
    Invoke-Native 'git' @('pull', '--rebase', '--autostash', 'origin', 'main')
  }

  # 3. Fetch Leboncoin (le code de sortie est non nul si une source échoue ; on continue pour mettre le site à jour)
  $fetchArgs = @('--env-file=.env', '.agents/skills/leboncoin_fetch/scripts/fetch_listings.js', '--sources=leboncoin')
  if ($DryRun) { $fetchArgs += '--dry-run' }
  & node @fetchArgs 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) {
    $failed = $true
    Write-Host "Le fetch a signalé des erreurs (code $LASTEXITCODE) : voir immo_run_log." -ForegroundColor Yellow
  }

  # 4. Régénérer le site, commiter et déployer
  if (-not $DryRun) {
    Invoke-Native 'npm' @('run', 'generate')
    Invoke-Native 'git' @('add', '-A', 'docs', 'leboncoin_searches')
    & git diff --cached --quiet
    if ($LASTEXITCODE -ne 0) {
      Invoke-Native 'git' @('commit', '-m', "chore: actualiser les annonces du $(Get-Date -Format 'yyyy-MM-dd') (local)")
      Invoke-Native 'git' @('pull', '--rebase', '--autostash', 'origin', 'main')
      Invoke-Native 'git' @('push', 'origin', 'HEAD:main')
      Invoke-Native 'gh' @('workflow', 'run', 'deploy.yml', '--ref', 'main')
      Write-Host 'Site mis à jour et déploiement lancé.'
    } else {
      Write-Host 'Aucun changement à publier.'
    }
  }
} catch {
  $failed = $true
  Write-Host "ERREUR : $_" -ForegroundColor Red
  & git rebase --abort 2>$null
} finally {
  if ($startedChrome -and -not $startedChrome.HasExited) {
    & taskkill /PID $startedChrome.Id /T /F | Out-Null
  }
  Stop-Transcript | Out-Null
}

if ($failed) { exit 1 }
