param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [string]$OutputDir = ".\excel-optimized-copies",

    [switch]$SkipShapeDeduplication,

    [switch]$SkipDxfCompaction,

    [switch]$KeepCalcChain
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

function Remove-ZipEntryIfExists {
    param($Zip, [string]$Name)

    $entry = $Zip.GetEntry($Name)
    if ($entry) {
        $entry.Delete()
        return $true
    }
    return $false
}

function Get-ChildText {
    param($Node, [System.Xml.XmlNamespaceManager]$Ns, [string]$XPath)

    $child = $Node.SelectSingleNode($XPath, $Ns)
    if ($child) { return $child.InnerText }
    return ""
}

function Get-ShapeDedupeKey {
    param($Anchor, [System.Xml.XmlNamespaceManager]$Ns)

    $shape = $Anchor.SelectSingleNode("xdr:sp", $Ns)
    if (-not $shape) { return $null }

    if ($Anchor.SelectSingleNode("xdr:pic|xdr:graphicFrame|xdr:grpSp|xdr:cxnSp", $Ns)) { return $null }
    if ($shape.SelectSingleNode(".//a:t", $Ns)) { return $null }
    if ($shape.SelectSingleNode(".//a:ln", $Ns)) { return $null }
    if (-not $shape.SelectSingleNode(".//a:noFill", $Ns)) { return $null }

    $macro = $shape.GetAttribute("macro")
    $textLink = $shape.GetAttribute("textlink")
    if ($macro -or $textLink) { return $null }

    $anchorKind = $Anchor.LocalName
    $fromCol = Get-ChildText $Anchor $Ns "xdr:from/xdr:col"
    $fromColOff = Get-ChildText $Anchor $Ns "xdr:from/xdr:colOff"
    $fromRow = Get-ChildText $Anchor $Ns "xdr:from/xdr:row"
    $fromRowOff = Get-ChildText $Anchor $Ns "xdr:from/xdr:rowOff"
    $toCol = Get-ChildText $Anchor $Ns "xdr:to/xdr:col"
    $toColOff = Get-ChildText $Anchor $Ns "xdr:to/xdr:colOff"
    $toRow = Get-ChildText $Anchor $Ns "xdr:to/xdr:row"
    $toRowOff = Get-ChildText $Anchor $Ns "xdr:to/xdr:rowOff"

    $ext = $Anchor.SelectSingleNode("xdr:ext", $Ns)
    $cx = if ($ext) { $ext.GetAttribute("cx") } else { "" }
    $cy = if ($ext) { $ext.GetAttribute("cy") } else { "" }

    $geometry = $shape.SelectSingleNode(".//a:prstGeom", $Ns)
    $prst = if ($geometry) { $geometry.GetAttribute("prst") } else { "" }

    $hiddenFill = $shape.SelectSingleNode(".//*[local-name()='hiddenFill']", $Ns)
    $hiddenFillXml = if ($hiddenFill) { $hiddenFill.OuterXml } else { "" }

    return @(
        $anchorKind,
        $fromCol,
        $fromColOff,
        $fromRow,
        $fromRowOff,
        $toCol,
        $toColOff,
        $toRow,
        $toRowOff,
        $cx,
        $cy,
        $prst,
        $hiddenFillXml
    ) -join "|"
}

function Optimize-DrawingXml {
    param([string]$XmlText)

    $doc = [System.Xml.XmlDocument]::new()
    $doc.PreserveWhitespace = $false
    $doc.LoadXml($XmlText)

    $ns = [System.Xml.XmlNamespaceManager]::new($doc.NameTable)
    $ns.AddNamespace("xdr", "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing")
    $ns.AddNamespace("a", "http://schemas.openxmlformats.org/drawingml/2006/main")

    $seen = @{}
    $removed = 0
    $candidates = 0

    $anchors = @($doc.DocumentElement.ChildNodes | Where-Object {
            $_.NodeType -eq [System.Xml.XmlNodeType]::Element -and
            ($_.LocalName -eq "oneCellAnchor" -or $_.LocalName -eq "twoCellAnchor" -or $_.LocalName -eq "absoluteAnchor")
        })

    foreach ($anchor in $anchors) {
        $key = Get-ShapeDedupeKey $anchor $ns
        if (-not $key) { continue }

        $candidates++
        if ($seen.ContainsKey($key)) {
            [void]$anchor.ParentNode.RemoveChild($anchor)
            $removed++
        }
        else {
            $seen[$key] = $true
        }
    }

    return [pscustomobject]@{
        Xml = $doc.OuterXml
        Candidates = $candidates
        Removed = $removed
        KeptCandidateKeys = $seen.Count
    }
}

function Compact-Dxfs {
    param([string]$StylesXml)

    $doc = [System.Xml.XmlDocument]::new()
    $doc.PreserveWhitespace = $false
    $doc.LoadXml($StylesXml)

    $ns = [System.Xml.XmlNamespaceManager]::new($doc.NameTable)
    $ns.AddNamespace("m", "http://schemas.openxmlformats.org/spreadsheetml/2006/main")

    $dxfs = $doc.SelectSingleNode("//m:dxfs", $ns)
    if (-not $dxfs) {
        return [pscustomobject]@{
            Xml = $StylesXml
            OldCount = 0
            NewCount = 0
            Map = @{}
        }
    }

    $oldNodes = @($dxfs.ChildNodes | Where-Object { $_.NodeType -eq [System.Xml.XmlNodeType]::Element -and $_.LocalName -eq "dxf" })
    $styleToNewIndex = @{}
    $oldToNewIndex = @{}
    $uniqueNodes = New-Object System.Collections.Generic.List[System.Xml.XmlNode]

    for ($i = 0; $i -lt $oldNodes.Count; $i++) {
        $xml = $oldNodes[$i].OuterXml
        if ($styleToNewIndex.ContainsKey($xml)) {
            $oldToNewIndex[$i] = $styleToNewIndex[$xml]
        }
        else {
            $newIndex = $uniqueNodes.Count
            $styleToNewIndex[$xml] = $newIndex
            $oldToNewIndex[$i] = $newIndex
            $uniqueNodes.Add($oldNodes[$i].CloneNode($true))
        }
    }

    $dxfs.RemoveAll()
    $countAttr = $doc.CreateAttribute("count")
    $countAttr.Value = [string]$uniqueNodes.Count
    [void]$dxfs.Attributes.Append($countAttr)

    foreach ($node in $uniqueNodes) {
        [void]$dxfs.AppendChild($node)
    }

    return [pscustomobject]@{
        Xml = $doc.OuterXml
        OldCount = $oldNodes.Count
        NewCount = $uniqueNodes.Count
        Map = $oldToNewIndex
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
$copyPath = Join-Path $resolvedOutputDir "$baseName - optimizado $timestamp$extension"
$summaryPath = Join-Path $resolvedOutputDir "$baseName - optimizado $timestamp.summary.json"

Copy-Item -LiteralPath $resolvedPath -Destination $copyPath

$summary = [ordered]@{
    Source = $resolvedPath
    Output = $copyPath
    StartedAt = (Get-Date).ToString("s")
    ShapeDeduplication = @()
    DxfCompaction = $null
    WorksheetDxfReferencesUpdated = @()
    CalcChainRemoved = $false
}

$zip = [System.IO.Compression.ZipFile]::Open($copyPath, [System.IO.Compression.ZipArchiveMode]::Update)
try {
    if (-not $SkipShapeDeduplication) {
        $drawingEntries = @($zip.Entries | Where-Object { $_.FullName -like "xl/drawings/drawing*.xml" })
        foreach ($entry in $drawingEntries) {
            $beforeLength = $entry.Length
            $xml = Read-ZipEntryText $zip $entry.FullName
            $optimized = Optimize-DrawingXml $xml

            if ($optimized.Removed -gt 0) {
                Set-ZipEntryText $zip $entry.FullName $optimized.Xml
            }

            $summary.ShapeDeduplication += [pscustomobject]@{
                File = $entry.FullName
                Candidates = $optimized.Candidates
                Removed = $optimized.Removed
                KeptCandidateKeys = $optimized.KeptCandidateKeys
                BeforeXmlBytes = $beforeLength
                AfterXmlBytes = if ($optimized.Removed -gt 0) { [Text.Encoding]::UTF8.GetByteCount($optimized.Xml) } else { $beforeLength }
            }
        }
    }

    if (-not $SkipDxfCompaction) {
        $stylesXml = Read-ZipEntryText $zip "xl/styles.xml"
        $compact = Compact-Dxfs $stylesXml

        if ($compact.OldCount -gt $compact.NewCount) {
            Set-ZipEntryText $zip "xl/styles.xml" $compact.Xml

            $worksheetEntries = @($zip.Entries | Where-Object { $_.FullName -like "xl/worksheets/sheet*.xml" })
            foreach ($entry in $worksheetEntries) {
                $xml = Read-ZipEntryText $zip $entry.FullName
                $updates = 0
                foreach ($match in [regex]::Matches($xml, 'dxfId="(\d+)"')) {
                    if ($compact.Map.ContainsKey([int]$match.Groups[1].Value)) {
                        $updates++
                    }
                }

                $newXml = [regex]::Replace($xml, 'dxfId="(\d+)"', {
                        param($match)
                        $old = [int]$match.Groups[1].Value
                        if ($compact.Map.ContainsKey($old)) {
                            return 'dxfId="' + $compact.Map[$old] + '"'
                        }
                        return $match.Value
                    })

                if ($updates -gt 0) {
                    Set-ZipEntryText $zip $entry.FullName $newXml
                }

                $summary.WorksheetDxfReferencesUpdated += [pscustomobject]@{
                    File = $entry.FullName
                    ReferencesUpdated = $updates
                }
            }
        }

        $summary.DxfCompaction = [pscustomobject]@{
            OldCount = $compact.OldCount
            NewCount = $compact.NewCount
            Removed = $compact.OldCount - $compact.NewCount
        }
    }

    if (-not $KeepCalcChain) {
        $summary.CalcChainRemoved = Remove-ZipEntryIfExists $zip "xl/calcChain.xml"
    }
}
finally {
    $zip.Dispose()
}

$summary.CompletedAt = (Get-Date).ToString("s")
$summary.OutputFileMB = [math]::Round((Get-Item -LiteralPath $copyPath).Length / 1MB, 2)
$summary | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 -LiteralPath $summaryPath

Write-Host "Copia optimizada creada:"
Write-Host $copyPath
Write-Host ""
Write-Host "Resumen JSON:"
Write-Host $summaryPath
Write-Host ""
Write-Host "Tamano final: $($summary.OutputFileMB) MB"
if ($summary.DxfCompaction) {
    Write-Host "dxf compactados: $($summary.DxfCompaction.OldCount) -> $($summary.DxfCompaction.NewCount)"
}
$removedShapes = ($summary.ShapeDeduplication | Measure-Object Removed -Sum).Sum
Write-Host "Formas duplicadas removidas: $removedShapes"
Write-Host "CalcChain removido: $($summary.CalcChainRemoved)"
