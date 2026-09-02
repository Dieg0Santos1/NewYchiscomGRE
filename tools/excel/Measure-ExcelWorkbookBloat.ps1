param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [string]$OutputDir = ".\excel-audit-output"
)

$ErrorActionPreference = "Stop"

function Open-ZipShared {
    param([string]$WorkbookPath)

    $fs = [System.IO.File]::Open(
        $WorkbookPath,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
    )
    $zip = [System.IO.Compression.ZipArchive]::new($fs, [System.IO.Compression.ZipArchiveMode]::Read, $true)

    return @{ Stream = $fs; Zip = $zip }
}

function Read-EntryText {
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

function Count-Matches {
    param($Text, [string]$Pattern)

    if ($null -eq $Text) { return 0 }
    return [regex]::Matches($Text, $Pattern).Count
}

function Get-DeclaredCount {
    param($Text, [string]$Tag)

    $pattern = ('<{0}\b[^>]*\bcount="(\d+)"' -f [regex]::Escape($Tag))
    $match = [regex]::Match($Text, $pattern)
    if ($match.Success) { return [int]$match.Groups[1].Value }
    return $null
}

function Resolve-XlTarget {
    param([string]$Target)

    if (-not $Target) { return $null }
    if ($Target.StartsWith("xl/")) { return $Target }
    return "xl/" + $Target.TrimStart("/").Replace("../", "")
}

Add-Type -AssemblyName System.IO.Compression

$resolvedPath = (Resolve-Path -LiteralPath $Path).Path
$resolvedOutputDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDir)
New-Item -ItemType Directory -Force -Path $resolvedOutputDir | Out-Null

$opened = Open-ZipShared $resolvedPath
$zip = $opened.Zip

try {
    $workbookText = Read-EntryText $zip "xl/workbook.xml"
    $workbookRelsText = Read-EntryText $zip "xl/_rels/workbook.xml.rels"

    [xml]$workbook = $workbookText
    [xml]$workbookRels = $workbookRelsText

    $ns = [System.Xml.XmlNamespaceManager]::new($workbook.NameTable)
    $ns.AddNamespace("m", "http://schemas.openxmlformats.org/spreadsheetml/2006/main")
    $ns.AddNamespace("r", "http://schemas.openxmlformats.org/officeDocument/2006/relationships")

    $relMap = @{}
    foreach ($rel in $workbookRels.Relationships.Relationship) {
        $relMap[$rel.Id] = $rel.Target
    }

    $sheets = foreach ($sheetNode in $workbook.SelectNodes("//m:sheets/m:sheet", $ns)) {
        $rid = $sheetNode.GetAttribute("id", "http://schemas.openxmlformats.org/officeDocument/2006/relationships")
        [pscustomobject]@{
            Name = $sheetNode.name
            State = $sheetNode.state
            File = Resolve-XlTarget $relMap[$rid]
        }
    }

    $entries = @($zip.Entries)
    $entryNames = @($entries | Select-Object -ExpandProperty FullName)
    $fileInfo = Get-Item -LiteralPath $resolvedPath

    $calcChainText = Read-EntryText $zip "xl/calcChain.xml"
    $stylesText = Read-EntryText $zip "xl/styles.xml"
    $calcPr = $workbook.SelectSingleNode("//m:calcPr", $ns)

    $workbookSummary = [pscustomobject]@{
        Workbook = $resolvedPath
        FileMB = [math]::Round($fileInfo.Length / 1MB, 2)
        ZipEntries = $entries.Count
        UncompressedMB = [math]::Round((($entries | Measure-Object Length -Sum).Sum) / 1MB, 2)
        CompressedMB = [math]::Round((($entries | Measure-Object CompressedLength -Sum).Sum) / 1MB, 2)
        SheetCount = $sheets.Count
        HasVbaProject = [bool]($entryNames -contains "xl/vbaProject.bin")
        ExternalLinkFiles = @($entryNames | Where-Object { $_ -like "xl/externalLinks/*" }).Count
        Connections = @($entryNames | Where-Object { $_ -eq "xl/connections.xml" }).Count
        QueryTables = @($entryNames | Where-Object { $_ -like "xl/queryTables/*" }).Count
        PivotCaches = @($entryNames | Where-Object { $_ -like "xl/pivotCache/*" }).Count
        PivotTables = @($entryNames | Where-Object { $_ -like "xl/pivotTables/*" }).Count
        Tables = @($entryNames | Where-Object { $_ -like "xl/tables/*" }).Count
        DrawingFiles = @($entryNames | Where-Object { $_ -like "xl/drawings/drawing*.xml" }).Count
        MediaFiles = @($entryNames | Where-Object { $_ -like "xl/media/*" }).Count
        CalcChainEntriesApprox = Count-Matches $calcChainText '<c\b'
        CalcMode = if ($calcPr) { $calcPr.calcMode } else { $null }
        CalcId = if ($calcPr) { $calcPr.calcId } else { $null }
    }

    $sheetMetrics = foreach ($sheet in $sheets) {
        $text = Read-EntryText $zip $sheet.File
        if ($null -eq $text) { continue }

        $dimension = ([regex]::Match($text, '<dimension\s+ref="([^"]+)"')).Groups[1].Value

        [pscustomobject]@{
            Sheet = $sheet.Name
            State = $sheet.State
            File = $sheet.File
            XmlMB = [math]::Round(($zip.GetEntry($sheet.File).Length / 1MB), 2)
            Dimension = $dimension
            RowsWithData = Count-Matches $text '<row\b'
            CellNodes = Count-Matches $text '<c\b'
            FormulaNodes = Count-Matches $text '<f(\s|>|/)'
            StyledCells = Count-Matches $text '<c\b[^>]*\ss="\d+"'
            ConditionalFormattingBlocks = Count-Matches $text '<conditionalFormatting\b'
            ConditionalFormattingRules = Count-Matches $text '<cfRule\b'
            DataValidations = Count-Matches $text '<dataValidation\b'
            MergedCells = Count-Matches $text '<mergeCell\b'
            Hyperlinks = Count-Matches $text '<hyperlink\b'
            DrawingRefs = Count-Matches $text '<drawing\b'
            VolatileFunctionHits = Count-Matches $text '(?i)\b(NOW|TODAY|RAND|RANDBETWEEN|OFFSET|INDIRECT|CELL|INFO)\s*\('
            LookupFunctionHits = Count-Matches $text '(?i)\b(VLOOKUP|XLOOKUP|INDEX|MATCH|GETPIVOTDATA)\s*\('
            HeavyFunctionHits = Count-Matches $text '(?i)\b(SUMPRODUCT|FILTER|SORT|UNIQUE)\s*\('
        }
    }

    $drawingMetrics = foreach ($entry in ($entries | Where-Object { $_.FullName -like "xl/drawings/drawing*.xml" })) {
        $drawingText = Read-EntryText $zip $entry.FullName

        [pscustomobject]@{
            File = $entry.FullName
            XmlMB = [math]::Round($entry.Length / 1MB, 2)
            Anchors = Count-Matches $drawingText '<xdr:(twoCellAnchor|oneCellAnchor|absoluteAnchor)\b'
            Shapes = Count-Matches $drawingText '<xdr:sp\b'
            Pictures = Count-Matches $drawingText '<xdr:pic\b'
            GraphicFrames = Count-Matches $drawingText '<xdr:graphicFrame\b'
            ClientData = Count-Matches $drawingText '<xdr:clientData\b'
        }
    }

    $drawingToSheet = foreach ($sheet in $sheets) {
        $sheetNumber = ([regex]::Match($sheet.File, 'sheet(\d+)\.xml')).Groups[1].Value
        if (-not $sheetNumber) { continue }

        $relsPath = "xl/worksheets/_rels/sheet$sheetNumber.xml.rels"
        $relsText = Read-EntryText $zip $relsPath
        if (-not $relsText) { continue }

        [xml]$sheetRels = $relsText
        foreach ($rel in $sheetRels.Relationships.Relationship) {
            if ($rel.Type -notlike "*drawing") { continue }

            $drawingPath = Resolve-XlTarget $rel.Target
            $drawingEntry = $zip.GetEntry($drawingPath)
            $drawingText = Read-EntryText $zip $drawingPath

            [pscustomobject]@{
                Sheet = $sheet.Name
                SheetFile = $sheet.File
                Drawing = $drawingPath
                DrawingXmlMB = if ($drawingEntry) { [math]::Round($drawingEntry.Length / 1MB, 2) } else { $null }
                Shapes = Count-Matches $drawingText '<xdr:sp\b'
                Anchors = Count-Matches $drawingText '<xdr:(twoCellAnchor|oneCellAnchor|absoluteAnchor)\b'
            }
        }
    }

    $stylesSummary = [pscustomobject]@{
        StylesXmlMB = if ($stylesText) { [math]::Round(($zip.GetEntry("xl/styles.xml").Length / 1MB), 2) } else { 0 }
        CellXfsDeclared = Get-DeclaredCount $stylesText "cellXfs"
        DxfsDeclared = Get-DeclaredCount $stylesText "dxfs"
        FontsDeclared = Get-DeclaredCount $stylesText "fonts"
        FillsDeclared = Get-DeclaredCount $stylesText "fills"
        BordersDeclared = Get-DeclaredCount $stylesText "borders"
        NumFmtsDeclared = Get-DeclaredCount $stylesText "numFmts"
        XfTags = Count-Matches $stylesText '<xf\b'
        DxfTags = Count-Matches $stylesText '<dxf\b'
        FontTags = Count-Matches $stylesText '<font\b'
        FillTags = Count-Matches $stylesText '<fill\b'
        BorderTags = Count-Matches $stylesText '<border\b'
        NumFmtTags = Count-Matches $stylesText '<numFmt\b'
    }

    $externalLinks = foreach ($entry in ($entries | Where-Object { $_.FullName -like "xl/externalLinks/_rels/*.rels" })) {
        [xml]$externalRels = Read-EntryText $zip $entry.FullName
        foreach ($rel in $externalRels.Relationships.Relationship) {
            [pscustomobject]@{
                RelFile = $entry.FullName
                TargetMode = $rel.TargetMode
                Target = $rel.Target
                Type = $rel.Type
            }
        }
    }

    $largestParts = $entries |
        Sort-Object Length -Descending |
        Select-Object -First 30 @{ Name = "MB"; Expression = { [math]::Round($_.Length / 1MB, 2) } },
            @{ Name = "CompressedMB"; Expression = { [math]::Round($_.CompressedLength / 1MB, 2) } },
            FullName

    $workbookSummary | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $resolvedOutputDir "workbook-summary.json")
    $workbookSummary | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath (Join-Path $resolvedOutputDir "workbook-summary.csv")
    $sheetMetrics | Sort-Object XmlMB -Descending | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath (Join-Path $resolvedOutputDir "sheet-metrics.csv")
    $drawingMetrics | Sort-Object XmlMB -Descending | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath (Join-Path $resolvedOutputDir "drawing-metrics.csv")
    $drawingToSheet | Sort-Object DrawingXmlMB -Descending | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath (Join-Path $resolvedOutputDir "drawing-to-sheet.csv")
    $stylesSummary | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath (Join-Path $resolvedOutputDir "styles-summary.csv")
    $externalLinks | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath (Join-Path $resolvedOutputDir "external-links.csv")
    $largestParts | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath (Join-Path $resolvedOutputDir "largest-internal-parts.csv")

    $totalFormulas = ($sheetMetrics | Measure-Object FormulaNodes -Sum).Sum
    $totalVolatile = ($sheetMetrics | Measure-Object VolatileFunctionHits -Sum).Sum
    $totalHeavy = ($sheetMetrics | Measure-Object HeavyFunctionHits -Sum).Sum
    $totalRules = ($sheetMetrics | Measure-Object ConditionalFormattingRules -Sum).Sum
    $totalShapes = ($drawingMetrics | Measure-Object Shapes -Sum).Sum

    $topDrawingRows = ($drawingToSheet |
        Sort-Object DrawingXmlMB -Descending |
        Select-Object -First 8 |
        ForEach-Object { "| $($_.Sheet) | $($_.DrawingXmlMB) | $($_.Shapes) |" }) -join [Environment]::NewLine

    $report = @"
# Excel performance audit

Archivo: `$($resolvedPath)`

## Resumen

| Metrica | Valor |
|---|---:|
| Tamano del archivo | $($workbookSummary.FileMB) MB |
| Tamano interno descomprimido | $($workbookSummary.UncompressedMB) MB |
| Hojas | $($workbookSummary.SheetCount) |
| Macros VBA | $($workbookSummary.HasVbaProject) |
| Formulas totales | $totalFormulas |
| Hits de funciones volatiles | $totalVolatile |
| Hits de funciones pesadas revisadas | $totalHeavy |
| Reglas de formato condicional | $totalRules |
| Formas/dibujos aproximados | $totalShapes |
| Archivos de vinculos externos | $($workbookSummary.ExternalLinkFiles) |
| Tablas dinamicas | $($workbookSummary.PivotTables) |

## Hojas con mas dibujos

| Hoja | XML de dibujo MB | Formas |
|---|---:|---:|
$topDrawingRows

## Archivos generados

- `workbook-summary.csv`
- `sheet-metrics.csv`
- `drawing-metrics.csv`
- `drawing-to-sheet.csv`
- `styles-summary.csv`
- `external-links.csv`
- `largest-internal-parts.csv`

"@

    $reportPath = Join-Path $resolvedOutputDir "audit-report.md"
    $report | Set-Content -Encoding UTF8 -LiteralPath $reportPath

    Write-Host "Auditoria creada en: $resolvedOutputDir"
    Write-Host "Reporte principal: $reportPath"
    Write-Host ""
    Write-Host "Resumen rapido:"
    $workbookSummary | Format-List
    Write-Host "Formulas: $totalFormulas | Volatiles: $totalVolatile | Formato condicional: $totalRules | Formas: $totalShapes"
}
finally {
    $zip.Dispose()
    $opened.Stream.Dispose()
}
