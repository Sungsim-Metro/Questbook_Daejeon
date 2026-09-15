param([string]$ProjectId = '12026216139051309923')
$ErrorActionPreference = 'Stop'
if (-not $env:STITCH_API_KEY) { throw 'STITCH_API_KEY is required.' }
$headers = @{ 'X-Goog-Api-Key' = $env:STITCH_API_KEY; Accept = 'application/json, text/event-stream' }
$body = @{ jsonrpc = '2.0'; id = 1; method = 'tools/call'; params = @{ name = 'list_screens'; arguments = @{ projectId = $ProjectId } } } | ConvertTo-Json -Depth 8 -Compress
$result = Invoke-RestMethod -Uri 'https://stitch.googleapis.com/mcp' -Method Post -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 45
if ($result.error -or $result.result.isError) { throw 'Stitch rejected the read request.' }
$data = $result.result.structuredContent
if (-not $data) { $data = ($result.result.content | Where-Object { $_.type -eq 'text' } | Select-Object -First 1).text | ConvertFrom-Json }
$target = Join-Path $PSScriptRoot '../.questbook/stitch'
New-Item -ItemType Directory -Force -Path $target | Out-Null
$data.screens | Select-Object name,title,width,height | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 (Join-Path $target 'screens.json')
foreach ($screen in $data.screens) {
    if ($screen.title -notmatch '^S\d\d') { continue }
    $id = ($screen.name -split '/')[-1]
    foreach ($asset in @(@{ file = "$id.html"; url = $screen.htmlCode.downloadUrl }, @{ file = "$id.png"; url = $screen.screenshot.downloadUrl })) {
        if (-not $asset.url) { continue }
        $uri = [uri]$asset.url
        if ($uri.Scheme -ne 'https' -or ($uri.Host -notmatch '(^|\.)googleusercontent\.com$' -and $uri.Host -notmatch '(^|\.)googleapis\.com$' -and $uri.Host -ne 'contribution.usercontent.google.com')) { throw "Unexpected asset host: $($uri.Host)" }
        $file = Join-Path $target $asset.file
        if (-not (Test-Path -LiteralPath $file)) { Invoke-WebRequest -UseBasicParsing -Uri $uri -OutFile $file -TimeoutSec 45 }
    }
    Write-Output "$id $($screen.title)"
}
