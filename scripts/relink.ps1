# Re-create the two node_modules junctions this bundle needs:
# 1) <package>/node_modules -> a live DSH installation's node_modules
#    (resolves @deepseek-ai/* imports of the host half, e.g. dsh-tools).
# 2) %USERPROFILE%\.dsh\profiles\web\node_modules\dsh-page-preview
#    -> this package directory (the profile's module resolution anchor;
#    the profile patch-layer row "dsh-page-preview" resolves from here).
param(
    [string]$DshModules = "C:\Users\cwtan\AppData\Local\npm-cache\_npx\1e7f6d9597241db0\node_modules",
    [string]$ProfileModules = "$env:USERPROFILE\.dsh\profiles\web\node_modules"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path (Join-Path $DshModules "@deepseek-ai\dsh-tools"))) {
    throw "DSH install anchor not found under: $DshModules"
}

# 1) package-local dependency junction
$local = Join-Path $PSScriptRoot "..\node_modules"
if (Test-Path $local) { (Get-Item $local).Delete() }
New-Item -ItemType Junction -Path $local -Target $DshModules | Out-Null
Write-Host "linked: $local -> $DshModules"

# 2) profile node_modules entry
if (-not (Test-Path $ProfileModules)) { New-Item -ItemType Directory -Path $ProfileModules -Force | Out-Null }
$profileLink = Join-Path $ProfileModules "dsh-page-preview"
if (Test-Path $profileLink) { (Get-Item $profileLink).Delete() }
New-Item -ItemType Junction -Path $profileLink -Target (Resolve-Path (Join-Path $PSScriptRoot "..")) | Out-Null
Write-Host "linked: $profileLink -> $(Resolve-Path (Join-Path $PSScriptRoot ".."))"

Write-Host ""
Write-Host "The profile's cordis.patch.yml must carry the insert row:"
Write-Host ""
Write-Host "  - insert:"
Write-Host "      - id: dsh-page-preview"
Write-Host "        name: 'dsh-page-preview'"
Write-Host ""
Write-Host "Use exactly ONE layer (profile patch OR the bundle entry in dsh.profile.bundles)."
