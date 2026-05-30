# DSOS built-in LLM model downloader (Windows / PowerShell).
#
# Pulls MythoMax-L2-13B Q4_K_M (~7.4 GB) from Hugging Face into backend/models/.
# That file is gitignored — every fresh clone needs to run this once before
# the built-in Shadows backend will work.
#
# Run from anywhere:
#   pwsh backend\scripts\download-model.ps1
# Or from this folder:
#   pwsh .\download-model.ps1

$ErrorActionPreference = "Stop"

# Resolve backend/models relative to this script, regardless of cwd.
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$modelsDir = Resolve-Path (Join-Path $scriptDir "..\models") -ErrorAction SilentlyContinue
if (-not $modelsDir) {
    $modelsDir = Join-Path (Split-Path -Parent $scriptDir) "models"
    New-Item -ItemType Directory -Path $modelsDir -Force | Out-Null
}

$fileName = "mythomax-l2-13b.Q4_K_M.gguf"
$dest = Join-Path $modelsDir $fileName
$url  = "https://huggingface.co/TheBloke/MythoMax-L2-13B-GGUF/resolve/main/$fileName"

if (Test-Path $dest) {
    $sizeMB = [int]((Get-Item $dest).Length / 1MB)
    Write-Host "[skip] $fileName already exists ($sizeMB MB)" -ForegroundColor Green
    Write-Host "       delete it first if you want to re-download."
    exit 0
}

Write-Host "[dsos] Downloading MythoMax-L2-13B Q4_K_M (~7.4 GB) from Hugging Face..." -ForegroundColor Cyan
Write-Host "       source: $url"
Write-Host "       dest:   $dest"
Write-Host ""

# curl.exe ships with Windows 10+ and shows a real progress bar.
# -L follows the HF redirect, --fail surfaces HTTP errors as non-zero exit.
$curl = Get-Command curl.exe -ErrorAction SilentlyContinue
if ($curl) {
    & curl.exe -L --fail --output $dest $url
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[error] curl exited with code $LASTEXITCODE" -ForegroundColor Red
        if (Test-Path $dest) { Remove-Item $dest -Force }
        exit 1
    }
} else {
    # Fallback: Invoke-WebRequest. Slower for big files; progress is jankier.
    Write-Host "[warn] curl.exe not found, falling back to Invoke-WebRequest (slower)" -ForegroundColor Yellow
    $ProgressPreference = "Continue"
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
}

$sizeGB = [math]::Round((Get-Item $dest).Length / 1GB, 2)
Write-Host ""
Write-Host "[done] $fileName downloaded ($sizeGB GB)" -ForegroundColor Green
Write-Host "       Built-in Shadows backend should now work after npm run dev."
