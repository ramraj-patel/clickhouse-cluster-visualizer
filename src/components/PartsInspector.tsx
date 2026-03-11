import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react'
import { usePartsSummary, useActiveMerges } from '../hooks/usePartsData'
import { fetchPartsForTable, fetchPartLog } from '../api/clickhouse'
import { fmtBytes, fmtRows, fmtDuration, fmtAge } from '../utils/format'
import { safeNum } from '../api/clickhouse'
import type { ConnectionConfig, PartSummaryRow, PartDetailRow, PartLogRow } from '../types'

interface Props {
  config: ConnectionConfig
}

// ─── Health helpers ───────────────────────────────────────────────────────────

function partHealth(row: PartSummaryRow): 'danger' | 'warn' | 'ok' {
  if (safeNum(row.avg_parts_per_partition) > 300 || safeNum(row.unmerged_parts) > 150) return 'danger'
  if (safeNum(row.avg_parts_per_partition) > 100 || safeNum(row.unmerged_parts) > 50 || safeNum(row.compression_ratio) < 2) return 'warn'
  return 'ok'
}

// ─── Part type badge ──────────────────────────────────────────────────────────

function PartTypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    Wide:     'bg-blue-500/10 text-blue-400 border-blue-500/20',
    Compact:  'bg-purple-500/10 text-purple-400 border-purple-500/20',
    InMemory: 'bg-green-500/10 text-green-400 border-green-500/20',
  }
  return (
    <span className={`text-[9px] px-1 py-0.5 rounded border ${styles[type] ?? 'bg-ch-border/40 text-ch-muted border-ch-border'}`}>
      {type || 'Wide'}
    </span>
  )
}

// ─── Event type badge ─────────────────────────────────────────────────────────

function EventBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    NewPart:      'bg-green-500/10 text-green-400 border-green-500/20',
    MergeParts:   'bg-blue-500/10 text-blue-400 border-blue-500/20',
    DownloadPart: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
    RemovePart:   'bg-red-500/10 text-red-400 border-red-500/20',
    MutatePart:   'bg-orange-500/10 text-orange-400 border-orange-500/20',
  }
  return (
    <span className={`text-[9px] px-1 py-0.5 rounded border ${styles[type] ?? 'bg-ch-border/40 text-ch-muted border-ch-border'}`}>
      {type}
    </span>
  )
}

// ─── Part history ─────────────────────────────────────────────────────────────

function PartHistory({
  config,
  database,
  table,
}: { config: ConnectionConfig; database: string; table: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['part_log', config, database, table],
    queryFn: () => fetchPartLog(config, database, table),
    staleTime: 60_000,
  })
  if (isLoading) return <div className="text-xs text-ch-muted py-3 animate-pulse px-4">Loading history…</div>
  if (!data?.length) return <div className="text-xs text-ch-muted py-3 px-4">No part events in the last 24h. (system.part_log may be disabled)</div>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[10px]">
        <thead>
          <tr className="text-ch-muted border-b border-ch-border bg-ch-bg/50">
            <th className="text-left py-1.5 px-3">Time</th>
            <th className="text-left py-1.5 px-3">Event</th>
            <th className="text-left py-1.5 px-3">Part</th>
            <th className="text-right py-1.5 px-3">Duration</th>
            <th className="text-right py-1.5 px-3">Rows</th>
            <th className="text-right py-1.5 px-3">Size</th>
          </tr>
        </thead>
        <tbody>
          {(data as PartLogRow[]).map((r, i) => (
            <tr key={i} className="border-b border-ch-border/30 hover:bg-ch-bg/30">
              <td className="py-1.5 px-3 font-mono text-ch-muted">{r.event_time.slice(11)}</td>
              <td className="py-1.5 px-3"><EventBadge type={r.event_type} /></td>
              <td className="py-1.5 px-3 font-mono text-ch-text truncate max-w-48">{r.part_name}</td>
              <td className="py-1.5 px-3 text-right text-ch-muted">{fmtDuration(safeNum(r.duration_ms))}</td>
              <td className="py-1.5 px-3 text-right text-ch-muted">{fmtRows(safeNum(r.rows))}</td>
              <td className="py-1.5 px-3 text-right text-ch-muted">{fmtBytes(safeNum(r.size_in_bytes))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Partition row ────────────────────────────────────────────────────────────

function PartitionSection({ parts, partitionId }: { parts: PartDetailRow[]; partitionId: string }) {
  const [open, setOpen] = useState(false)
  const totalBytes = parts.reduce((s, p) => s + safeNum(p.bytes_on_disk), 0)
  const totalRows  = parts.reduce((s, p) => s + safeNum(p.rows), 0)
  const warnColor  = parts.length > 300 ? 'text-red-400' : parts.length > 100 ? 'text-yellow-400' : 'text-ch-text'

  return (
    <div className="border-b border-ch-border/30 last:border-0">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-6 py-2 text-left hover:bg-ch-bg/30 transition-colors"
      >
        {open ? <ChevronDown className="w-3 h-3 text-ch-muted flex-shrink-0" /> : <ChevronRight className="w-3 h-3 text-ch-muted flex-shrink-0" />}
        <span className="text-xs font-mono text-ch-text flex-1">{partitionId || '(default)'}</span>
        <span className={`text-xs font-semibold ${warnColor} w-20 text-right`}>{parts.length} parts</span>
        <span className="text-xs text-ch-muted w-24 text-right">{fmtRows(totalRows)}</span>
        <span className="text-xs text-ch-muted w-24 text-right">{fmtBytes(totalBytes)}</span>
      </button>
      {open && (
        <div className="bg-ch-bg/20 border-t border-ch-border/20">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-ch-muted border-b border-ch-border/30">
                <th className="text-left py-1.5 pl-12 pr-3">Part name</th>
                <th className="text-left py-1.5 px-3">Type</th>
                <th className="text-right py-1.5 px-3">Level</th>
                <th className="text-right py-1.5 px-3">Rows</th>
                <th className="text-right py-1.5 px-3">Size</th>
                <th className="text-right py-1.5 px-3">Uncompressed</th>
                <th className="text-right py-1.5 px-3">Refcount</th>
                <th className="text-left py-1.5 px-3">Disk</th>
                <th className="text-left py-1.5 px-3">Modified</th>
              </tr>
            </thead>
            <tbody>
              {parts.map(p => (
                <tr key={p.name} className="border-b border-ch-border/20 hover:bg-ch-surface/30">
                  <td className="py-1.5 pl-12 pr-3 font-mono text-ch-text truncate max-w-48">{p.name}</td>
                  <td className="py-1.5 px-3"><PartTypeBadge type={p.part_type} /></td>
                  <td className="py-1.5 px-3 text-right text-ch-muted">{p.level}</td>
                  <td className="py-1.5 px-3 text-right text-ch-muted">{fmtRows(safeNum(p.rows))}</td>
                  <td className="py-1.5 px-3 text-right text-ch-text">{fmtBytes(safeNum(p.bytes_on_disk))}</td>
                  <td className="py-1.5 px-3 text-right text-ch-muted">{fmtBytes(safeNum(p.data_uncompressed_bytes))}</td>
                  <td className={`py-1.5 px-3 text-right ${safeNum(p.refcount) > 1 ? 'text-yellow-400' : 'text-ch-muted'}`}>
                    {p.refcount}
                  </td>
                  <td className="py-1.5 px-3 text-ch-muted font-mono">{p.disk_name}</td>
                  <td className="py-1.5 px-3 text-ch-muted">{fmtAge(p.modification_time)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Table row ────────────────────────────────────────────────────────────────

function TableRow({ row, config }: { row: PartSummaryRow; config: ConnectionConfig }) {
  const [open, setOpen]         = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const health = partHealth(row)
  const healthIcon = health === 'danger' ? '🔴' : health === 'warn' ? '🟡' : '🟢'

  const PARTS_LIMIT = 5000
  const { data: parts } = useQuery({
    queryKey: ['parts_detail', config, row.database, row.table],
    queryFn: () => fetchPartsForTable(config, row.database, row.table),
    enabled: open,
    staleTime: 60_000,
  })
  const partsTruncated = (parts?.length ?? 0) >= PARTS_LIMIT

  // Group parts by partition
  const partitions = useMemo(() => {
    if (!parts) return []
    const m = new Map<string, PartDetailRow[]>()
    for (const p of parts) {
      const key = p.partition_id
      if (!m.has(key)) m.set(key, [])
      m.get(key)!.push(p)
    }
    return [...m.entries()].sort((a, b) => {
      const sizeA = a[1].reduce((s, p) => s + safeNum(p.bytes_on_disk), 0)
      const sizeB = b[1].reduce((s, p) => s + safeNum(p.bytes_on_disk), 0)
      return sizeB - sizeA
    })
  }, [parts])

  const ratio = safeNum(row.compression_ratio)

  return (
    <div className="border-b border-ch-border last:border-0">
      {/* Table summary row */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-ch-bg/30 transition-colors"
      >
        <span>{healthIcon}</span>
        {open ? <ChevronDown className="w-3.5 h-3.5 text-ch-muted flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-ch-muted flex-shrink-0" />}
        <span className="text-xs font-semibold text-ch-text flex-1 truncate">
          <span className="text-ch-muted font-normal">{row.database}.</span>{row.table}
        </span>
        <span className="text-xs text-ch-muted w-20 text-right">{safeNum(row.part_count)} parts</span>
        <span className="text-xs text-ch-muted w-24 text-right">{safeNum(row.partition_count)} partitions</span>
        <span className="text-xs text-ch-text w-24 text-right">{fmtBytes(safeNum(row.total_bytes))}</span>
        <span className="text-xs text-ch-muted w-28 text-right">{fmtBytes(safeNum(row.total_uncompressed))}</span>
        <span className={`text-xs w-16 text-right font-semibold ${ratio < 2 ? 'text-yellow-400' : 'text-green-400'}`}>
          {ratio.toFixed(1)}×
        </span>
        <span className="text-xs text-ch-muted w-24 text-right">{fmtRows(safeNum(row.total_rows))}</span>
      </button>

      {/* Expanded: partition browser + history */}
      {open && (
        <div className="bg-ch-bg/20 border-t border-ch-border/30">
          {/* Partition header */}
          <div className="flex items-center justify-between px-6 py-2 border-b border-ch-border/30">
            <span className="text-[10px] font-semibold text-ch-muted uppercase tracking-wider">
              Partitions ({partitions.length})
            </span>
            <div className="flex items-center gap-3 text-[10px] text-ch-muted">
              <span>Rows</span>
              <span>Size (compressed)</span>
              <button
                onClick={() => setShowHistory(v => !v)}
                className="text-ch-muted hover:text-ch-accent transition-colors border border-ch-border rounded px-2 py-0.5"
              >
                {showHistory ? 'Hide history' : 'Part history (24h)'}
              </button>
            </div>
          </div>

          {/* Part history */}
          {showHistory && (
            <div className="border-b border-ch-border/30">
              <PartHistory config={config} database={row.database} table={row.table} />
            </div>
          )}

          {/* Partition list */}
          {!parts ? (
            <div className="px-6 py-4 text-xs text-ch-muted animate-pulse">Loading partitions…</div>
          ) : (
            <>
              {partsTruncated && (
                <div className="mx-4 mb-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-xs">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  Showing first {PARTS_LIMIT.toLocaleString()} parts — table has more. Results are truncated.
                </div>
              )}
              {partitions.map(([pid, pparts]) => (
                <PartitionSection key={pid} partitionId={pid} parts={pparts} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function PartsInspector({ config }: Props) {
  const [filterDb, setFilterDb] = useState('__all__')
  const [search, setSearch]     = useState('')

  const { data: summary, isLoading: summaryLoading, refetch } = usePartsSummary(config)
  const { data: merges } = useActiveMerges(config)

  const parts = summary ?? []
  const activeMerges = merges ?? []

  const databases = useMemo(() => [...new Set(parts.map(p => p.database))].sort(), [parts])

  const filtered = useMemo(() => {
    let r = parts
    if (filterDb !== '__all__') r = r.filter(p => p.database === filterDb)
    if (search.trim()) r = r.filter(p =>
      `${p.database}.${p.table}`.toLowerCase().includes(search.toLowerCase())
    )
    return r
  }, [parts, filterDb, search])

  // Aggregate totals
  const totals = useMemo(() => ({
    tables:       filtered.length,
    parts:        filtered.reduce((s, p) => s + safeNum(p.part_count), 0),
    compressed:   filtered.reduce((s, p) => s + safeNum(p.total_bytes), 0),
    uncompressed: filtered.reduce((s, p) => s + safeNum(p.total_uncompressed), 0),
  }), [filtered])

  const overallRatio = totals.compressed > 0 ? totals.uncompressed / totals.compressed : 0

  // Health warnings
  const warnings = useMemo(() => {
    const w: string[] = []
    const highParts = filtered.filter(p => safeNum(p.avg_parts_per_partition) > 100)
    if (highParts.length > 0) w.push(`${highParts.length} table(s) have >100 parts/partition on average`)
    const staleUnmerged = filtered.filter(p => safeNum(p.unmerged_parts) > 50)
    if (staleUnmerged.length > 0) w.push(`${staleUnmerged.length} table(s) have >50 unmerged (level=0) parts`)
    const lowComp = filtered.filter(p => safeNum(p.compression_ratio) > 0 && safeNum(p.compression_ratio) < 2)
    if (lowComp.length > 0) w.push(`${lowComp.length} table(s) with compression ratio < 2× — check codecs`)
    const highRef = filtered.filter(p => safeNum(p.max_refcount) > 1)
    if (highRef.length > 0) w.push(`${highRef.length} table(s) have parts with refcount > 1 (held by merge/mutation)`)
    return w
  }, [filtered])

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Active merges banner */}
      {activeMerges.length > 0 && (
        <div className="flex items-center gap-3 px-6 py-2.5 bg-blue-500/8 border-b border-blue-500/20 text-xs flex-shrink-0">
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
          <span className="font-semibold text-blue-400">{activeMerges.length} active merge{activeMerges.length > 1 ? 's' : ''}</span>
          <span className="text-ch-muted">
            {activeMerges.map(m =>
              `${m.database}.${m.table} — ${(m.progress * 100).toFixed(0)}% (${m.elapsed.toFixed(0)}s elapsed${m.is_mutation ? ', mutation' : ''})`
            ).join(' · ')}
          </span>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-6 py-3 border-b border-ch-border bg-ch-surface/50 flex-shrink-0">
        <h2 className="text-sm font-semibold text-ch-text mr-2">Parts Inspector</h2>
        <select
          value={filterDb}
          onChange={e => setFilterDb(e.target.value)}
          className="bg-ch-bg border border-ch-border rounded-lg px-2.5 py-1.5 text-xs text-ch-text focus:outline-none focus:border-ch-accent/60"
        >
          <option value="__all__">All databases</option>
          {databases.map(db => <option key={db} value={db}>{db}</option>)}
        </select>
        <input
          type="text"
          placeholder="Search table…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-ch-bg border border-ch-border rounded-lg px-3 py-1.5 text-xs text-ch-text placeholder:text-ch-muted focus:outline-none focus:border-ch-accent/60 flex-1 min-w-32"
        />
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 text-xs text-ch-muted border border-ch-border rounded-lg px-2.5 py-1.5 hover:text-ch-text hover:border-ch-accent/30 transition-colors ml-auto"
        >
          <RefreshCw className={`w-3 h-3 ${summaryLoading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {summaryLoading ? (
          <div className="p-6 space-y-3">{[1,2,3].map(i => <div key={i} className="h-12 bg-ch-surface rounded-xl animate-pulse" />)}</div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-6 pb-4">
              {[
                { label: 'Tables',         value: totals.tables },
                { label: 'Total parts',    value: totals.parts.toLocaleString() },
                { label: 'Compressed',     value: fmtBytes(totals.compressed) },
                { label: 'Uncompressed',   value: fmtBytes(totals.uncompressed) },
                { label: 'Overall ratio',  value: `${overallRatio.toFixed(1)}×`, sub: `${((1 - 1/overallRatio)*100).toFixed(0)}% space saved` },
              ].map(s => (
                <div key={s.label} className="bg-ch-surface border border-ch-border rounded-xl px-4 py-3">
                  <div className="text-xs text-ch-muted">{s.label}</div>
                  <div className="text-lg font-bold text-ch-text mt-0.5">{s.value}</div>
                  {'sub' in s && s.sub && <div className="text-[10px] text-ch-muted mt-0.5">{s.sub}</div>}
                </div>
              ))}
            </div>

            {/* Health warnings */}
            {warnings.length > 0 && (
              <div className="mx-6 mb-4 p-3 bg-yellow-500/8 border border-yellow-500/20 rounded-xl space-y-1">
                {warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-yellow-300">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-yellow-400" />
                    {w}
                  </div>
                ))}
              </div>
            )}

            {/* Table list */}
            {filtered.length === 0 ? (
              <div className="text-center py-16 text-ch-muted text-sm">No parts found matching the current filter.</div>
            ) : (
              <div className="mx-6 mb-6 border border-ch-border rounded-xl overflow-hidden">
                {/* Header */}
                <div className="flex items-center gap-3 px-4 py-2 bg-ch-surface border-b border-ch-border text-[10px] text-ch-muted uppercase tracking-wider">
                  <span className="w-6" />
                  <span className="w-3.5" />
                  <span className="flex-1">Table</span>
                  <span className="w-20 text-right">Parts</span>
                  <span className="w-24 text-right">Partitions</span>
                  <span className="w-24 text-right">Compressed</span>
                  <span className="w-28 text-right">Uncompressed</span>
                  <span className="w-16 text-right">Ratio</span>
                  <span className="w-24 text-right">Rows</span>
                </div>
                {filtered.map(row => (
                  <TableRow key={`${row.database}.${row.table}`} row={row} config={config} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
