param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [string]$OutputDir = ".\excel-optimized-copies"
)

$ErrorActionPreference = "Stop"

function Read-ZipEntryText {
    param($Zip, [string]$Name)

    $entry = $Zip.GetEntry($Name)
    if (-not $entry) { return $null }

    $reader = [System.IO.StreamReader]::new($entry.Open())
    try {
        return $reader.ReadToEnd()
    }
    finally {
        $reader.Dispose()
    }
}

function Set-ZipEntryText {
    param($Zip, [string]$Name, [string]$Text)

    $existing = $Zip.GetEntry($Name)
    if ($existing) {
        $existing.Delete()
    }

    $entry = $Zip.CreateEntry($Name, [System.IO.Compression.CompressionLevel]::Optimal)
    $writer = [System.IO.StreamWriter]::new($entry.Open(), [System.Text.UTF8Encoding]::new($false))
    try {
        $writer.Write($Text)
    }
    finally {
        $writer.Dispose()
    }
}

function Get-RuleKey {
    param([System.Xml.XmlElement]$Rule)

    $clone = $Rule.CloneNode($true)
    [void]$clone.RemoveAttribute("priority")
    return $clone.OuterXml
}

function Add-UniqueSqrefTokens {
    param(
        [System.Collections.Generic.List[string]]$List,
        [hashtable]$Seen,
        [string]$Sqref
    )

    foreach ($token in ($Sqref -split "\s+")) {
        if (-not $token) { continue }
        if ($Seen.ContainsKey($token)) { continue }
        $Seen[$token] = $true
        $List.Add($token)
    }
}

function Consolidate-WorksheetConditionalFormatting {
    param([string]$XmlText)

    $doc = [System.Xml.XmlDocument]::new()
    $doc.PreserveWhitespace = $false
    $doc.LoadXml($XmlText)

    $ns = [System.Xml.XmlNamespaceManager]::new($doc.NameTable)
    $ns.AddNamespace("m", "http://schemas.openxmlformats.org/spreadsheetml/2006/main")

    $oldBlocks = @($doc.SelectNodes("/m:worksheet/m:conditionalFormatting", $ns))
    if ($oldBlocks.Count -eq 0) {
        return [pscustomobject]@{
            Xml = $XmlText
            OldBlocks = 0
            NewBlocks = 0
            OldRules = 0
            NewRules = 0
            Changed = $false
        }
    }

    $groups = [ordered]@{}
    $oldRules = 0

    foreach ($block in $oldBlocks) {
        $sqref = $block.GetAttribute("sqref")
        foreach ($rule in @($block.SelectNodes("m:cfRule", $ns))) {
            $oldRules++
            $key = Get-RuleKey $rule
            if (-not $groups.Contains($key)) {
                $ruleClone = $rule.CloneNode($true)
                [void]$ruleClone.RemoveAttribute("priority")

                $groups[$key] = [ordered]@{
                    Rule = $ruleClone
                    Sqrefs = [System.Collections.Generic.List[string]]::new()
                    SeenSqrefs = @{}
                }
            }

            Add-UniqueSqrefTokens $groups[$key].Sqrefs $groups[$key].SeenSqrefs $sqref
        }
    }

    $insertBefore = $oldBlocks[0]
    $parent = $insertBefore.ParentNode
    $priority = 1

    foreach ($group in $groups.Values) {
        $newBlock = $doc.CreateElement("conditionalFormatting", $doc.DocumentElement.NamespaceURI)
        $sqrefAttr = $doc.CreateAttribute("sqref")
        $sqrefAttr.Value = [string]::Join(" ", $group.Sqrefs)
        [void]$newBlock.Attributes.Append($sqrefAttr)

        $newRule = $group.Rule.CloneNode($true)
        $priorityAttr = $doc.CreateAttribute("priority")
        $priorityAttr.Value = [string]$priority
        [void]$newRule.Attributes.Append($priorityAttr)
        [void]$newBlock.AppendChild($newRule)
        [void]$parent.InsertBefore($newBlock, $insertBefore)

        $priority++
    }

    foreach ($block in $oldBlocks) {
        [void]$parent.RemoveChild($block)
    }

    return [pscustomobject]@{
        Xml = $doc.OuterXml
        OldBlocks = $oldBlocks.Count
        NewBlocks = $groups.Count
        OldRules = $oldRules
        NewRules = $groups.Count
        Changed = ($oldRules -ne $groups.Count)
    }
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$resolvedPath = (Resolve-Path -LiteralPath $Path).Path
$resolvedOutputDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDir)
New-Item -ItemType Directory -Force -Path $resolvedOutputDir | Out-Null

$sourceItem = Get-Item -LiteralPath $resolvedPath
$baseName = [System.IO.Path]::GetFileNameWithoutExtension($sourceItem.Name)
$extension = $sourceItem.Extension
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$copyPath = Join-Path $resolvedOutputDir "$baseName-cf-consolidado-$timestamp$extension"
$summaryPath = Join-Path $resolvedOutputDir "$baseName-cf-consolidado-$timestamp.summary.json"

Copy-Item -LiteralPath $resolvedPath -Destination $copyPath

$summary = [ordered]@{
    Source = $resolvedPath
    Output = $copyPath
    StartedAt = (Get-Date).ToString("s")
    Sheets = @()
}

$zip = [System.IO.Compression.ZipFile]::Open($copyPath, [System.IO.Compression.ZipArchiveMode]::Update)
try {
    $worksheetEntries = @($zip.Entries | Where-Object { $_.FullName -like "xl/worksheets/sheet*.xml" })
    foreach ($entry in $worksheetEntries) {
        $xml = Read-ZipEntryText $zip $entry.FullName
        $result = Consolidate-WorksheetConditionalFormatting $xml

        if ($result.Changed) {
            Set-ZipEntryText $zip $entry.FullName $result.Xml
        }

        $summary.Sheets += [pscustomobject]@{
            File = $entry.FullName
            OldBlocks = $result.OldBlocks
            NewBlocks = $result.NewBlocks
            OldRules = $result.OldRules
            NewRules = $result.NewRules
            Changed = $result.Changed
        }
    }
}
finally {
    $zip.Dispose()
}

$summary.CompletedAt = (Get-Date).ToString("s")
$summary.OutputFileMB = [math]::Round((Get-Item -LiteralPath $copyPath).Length / 1MB, 2)
$summary | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 -LiteralPath $summaryPath

Write-Host "Copia con formato condicional consolidado:"
Write-Host $copyPath
Write-Host ""
Write-Host "Resumen JSON:"
Write-Host $summaryPath
Write-Host ""
$oldRules = ($summary.Sheets | Measure-Object OldRules -Sum).Sum
$newRules = ($summary.Sheets | Measure-Object NewRules -Sum).Sum
Write-Host "Reglas de formato condicional: $oldRules -> $newRules"
Write-Host "Tamano final: $($summary.OutputFileMB) MB"
