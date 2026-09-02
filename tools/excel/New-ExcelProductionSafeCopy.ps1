param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [string]$OutputDir = ".\excel-clean-copies",

    [switch]$AlsoCreateXlsbWithExcel,

    [switch]$RemoveCalcChainFromCopy
)

$ErrorActionPreference = "Stop"

function Remove-ZipEntryIfExists {
    param($Zip, [string]$EntryName)

    $entry = $Zip.GetEntry($EntryName)
    if ($entry) {
        $entry.Delete()
        return $true
    }
    return $false
}

$resolvedPath = (Resolve-Path -LiteralPath $Path).Path
$resolvedOutputDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDir)
New-Item -ItemType Directory -Force -Path $resolvedOutputDir | Out-Null

$sourceItem = Get-Item -LiteralPath $resolvedPath
$baseName = [System.IO.Path]::GetFileNameWithoutExtension($sourceItem.Name)
$extension = $sourceItem.Extension
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$copyPath = Join-Path $resolvedOutputDir "$baseName - copia segura $timestamp$extension"

Copy-Item -LiteralPath $resolvedPath -Destination $copyPath
Write-Host "Copia creada sin tocar el original:"
Write-Host $copyPath

if ($RemoveCalcChainFromCopy) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem

    $zip = [System.IO.Compression.ZipFile]::Open($copyPath, [System.IO.Compression.ZipArchiveMode]::Update)
    try {
        $removed = Remove-ZipEntryIfExists $zip "xl/calcChain.xml"
        if ($removed) {
            Write-Host "Se elimino xl/calcChain.xml de la copia. Excel lo reconstruira al recalcular."
        }
        else {
            Write-Host "La copia no tenia xl/calcChain.xml."
        }
    }
    finally {
        $zip.Dispose()
    }
}

if ($AlsoCreateXlsbWithExcel) {
    $excel = $null
    $workbook = $null

    try {
        $xlsbPath = Join-Path $resolvedOutputDir "$baseName - copia segura $timestamp.xlsb"

        $excel = New-Object -ComObject Excel.Application
        $excel.Visible = $false
        $excel.DisplayAlerts = $false
        $excel.AskToUpdateLinks = $false

        # 0 = no actualizar vinculos externos al abrir.
        $workbook = $excel.Workbooks.Open($copyPath, 0, $true)

        # 50 = xlExcel12 / .xlsb. Conserva formulas, colores, hojas, formas y tablas dinamicas.
        $workbook.SaveAs($xlsbPath, 50)
        Write-Host "Copia XLSB creada:"
        Write-Host $xlsbPath
    }
    finally {
        if ($workbook) { $workbook.Close($false) | Out-Null }
        if ($excel) { $excel.Quit() | Out-Null }

        if ($workbook) { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($workbook) | Out-Null }
        if ($excel) { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null }
        [GC]::Collect()
        [GC]::WaitForPendingFinalizers()
    }
}

Write-Host ""
Write-Host "Nota: esta copia conserva formulas y colores. No elimina dibujos ni formato condicional,"
Write-Host "porque esas limpiezas pueden cambiar lo que el usuario ve en produccion."
