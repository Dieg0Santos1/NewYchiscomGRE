import { useMemo, useState } from 'react';
import { CheckCircle2, RefreshCw, Save, Search } from 'lucide-react';
import { flexoService } from '../services/FlexoService';
import type { FlexoEmpaqueAdjustment } from '../types/flexo';

const unitOptions = ['NIU', 'MLL', 'MIL', 'KGM', 'MTR', 'MTK', 'ZZ'];

export function FlexoAdjustmentsPage() {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<FlexoEmpaqueAdjustment[]>([]);
  const [units, setUnits] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState('');
  const [message, setMessage] = useState('');

  const rollsCount = useMemo(() => rows.filter((row) => isRolls(row.unidadMedida)).length, [rows]);

  async function search() {
    const normalized = query.trim();
    if (normalized.length < 2) {
      setMessage('Ingrese al menos 2 caracteres o el codigo de empaque.');
      return;
    }

    setLoading(true);
    setMessage('Buscando empaques Flexo...');

    try {
      const result = await flexoService.searchEmpaqueAdjustments(normalized);
      setRows(result);
      setUnits(Object.fromEntries(result.map((row) => [row.id, suggestUnit(row.unidadMedida)])));
      setMessage(result.length === 0 ? 'Sin empaques para mostrar.' : `${result.length} detalle(s) encontrados.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo buscar empaques.');
    } finally {
      setLoading(false);
    }
  }

  async function save(row: FlexoEmpaqueAdjustment) {
    const unidadMedida = units[row.id] ?? suggestUnit(row.unidadMedida);
    if (unidadMedida === canonicalUnit(row.unidadMedida)) {
      setMessage('Seleccione una unidad diferente antes de guardar.');
      return;
    }

    setSavingId(row.id);
    setMessage(`Actualizando empaque ${row.codigoEmpaque}...`);

    try {
      const result = await flexoService.updateEmpaqueUnidad({
        codigoEmpaque: row.codigoEmpaque,
        codigoProducto: row.codigoProducto,
        unidadMedida
      });
      setRows((current) => current.map((item) => item.id === row.id ? { ...item, unidadMedida: result.unidadNueva } : item));
      setUnits((current) => ({ ...current, [row.id]: result.unidadNueva }));
      setMessage(`Empaque ${result.codigoEmpaque} actualizado: ${result.unidadAnterior || '-'} → ${result.unidadNueva}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo guardar el ajuste.');
    } finally {
      setSavingId('');
    }
  }

  function clear() {
    setQuery('');
    setRows([]);
    setUnits({});
    setMessage('');
  }

  return (
    <section className="screen-panel flexo-adjustments-screen">
      <div className="page-heading flexo-adjustment-hero">
        <div>
          <h1>Ajustes Flexo</h1>
          <p>Busca un empaque, revisa su unidad actual y cambia solo el detalle que necesita salir en la guía.</p>
        </div>
        <div className="flexo-adjustment-hero-card">
          <span>Unidad de medida</span>
          <strong>Rolls → NIU</strong>
          <small>Guardado directo en empaque pendiente</small>
        </div>
      </div>

      <div className="search-strip flexo-adjustment-search">
        <label>
          Buscar empaque
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void search();
              }
            }}
            placeholder="Codigo de empaque, producto, descripcion o unidad"
          />
        </label>
        <button type="button" className="primary-button" disabled={loading} onClick={() => void search()}>
          <Search size={18} /> Buscar
        </button>
        <button type="button" className="secondary-button" onClick={clear}>
          <RefreshCw size={18} /> Limpiar
        </button>
      </div>

      {message && <div className="inline-message">{message}</div>}

      <div className="flexo-adjustment-summary">
        <span>{rows.length} detalle(s)</span>
        <span>{rollsCount} con Rolls/Rollo</span>
        <span>Solo se guardan detalles sin guía ni factura ligada</span>
      </div>

      <div className="flexo-adjustment-table-wrap">
        <table className="guide-list-table flexo-adjustment-table">
          <thead>
            <tr>
              <th>Empaque</th>
              <th>Producto</th>
              <th>Descripcion</th>
              <th>Cantidad</th>
              <th>Unidad actual</th>
              <th>Nueva unidad</th>
              <th>Accion</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty-row">
                  Busca un codigo de empaque para revisar y ajustar su unidad de medida.
                </td>
              </tr>
            ) : rows.map((row) => {
              const isLocked = Boolean(row.guiaRemision || row.guiaFactura);
              const selectedUnit = units[row.id] ?? suggestUnit(row.unidadMedida);
              const changed = selectedUnit !== canonicalUnit(row.unidadMedida);

              return (
                <tr key={row.id} className={isRolls(row.unidadMedida) ? 'flexo-needs-adjustment' : undefined}>
                  <td>{row.codigoEmpaque}</td>
                  <td>{row.codigoProducto}</td>
                  <td>{row.descripcion || '-'}</td>
                  <td>{formatNumber(row.cantidad)}</td>
                  <td>
                    <span className={isRolls(row.unidadMedida) ? 'status-rejected unit-pill' : 'status-sent unit-pill'}>
                      {row.unidadMedida || '-'}
                    </span>
                  </td>
                  <td>
                    <select
                      value={selectedUnit}
                      disabled={isLocked || savingId === row.id}
                      onChange={(event) => setUnits((current) => ({ ...current, [row.id]: event.target.value }))}
                    >
                      {unitOptions.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                      {selectedUnit && !unitOptions.includes(selectedUnit) && <option value={selectedUnit}>{selectedUnit}</option>}
                    </select>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="select-row-button"
                      disabled={isLocked || !changed || savingId === row.id}
                      title={isLocked ? `Ligado a ${row.guiaRemision || row.guiaFactura}` : changed ? 'Guardar nueva unidad' : 'Sin cambios por guardar'}
                      onClick={() => void save(row)}
                    >
                      {changed ? <Save size={16} /> : <CheckCircle2 size={16} />}
                      Guardar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function canonicalUnit(value: string) {
  return value.trim().toUpperCase();
}

function suggestUnit(value: string) {
  const unit = value.trim().toUpperCase();
  return isRolls(unit) ? 'NIU' : unit;
}

function isRolls(value: string) {
  return ['ROLLS', 'ROLLOS', 'ROLLO', 'ROLL', 'ROL'].includes(value.trim().toUpperCase());
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('es-PE', { maximumFractionDigits: 3 }).format(value);
}
