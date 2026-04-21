import { useState, useMemo, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, X, Filter, ChevronDown, ChevronRight, AlertCircle, Zap, Plus, SlidersHorizontal, Copy, Check, ArrowUp, ArrowDown, ChevronsUpDown, Loader2 } from 'lucide-react'
import { format as formatSql } from 'sql-formatter'
import { useQueryLog } from '../hooks/useQueryLog'
import {
  fetchQueryById,
  fetchQuerySubQueries,
  fetchQueryThreadDetail,
  fetchTableHotspots,
  fetchCrossShardBreakdown,
  fetchQueryLogFilterOptions,
  fetchClusters,
  safeNum,
} from '../api/clickhouse'
import { fmtBytes, fmtDuration, fmtRows, fmtMarks, fmtAge } from '../utils/format'
import type { ConnectionConfig, QueryLogRow, QueryThreadRow } from '../types'

interface Props {
  config: ConnectionConfig
  filterQueryId: string | null
  onClearFilter: () => void
}

// ─── Cost scoring ─────────────────────────────────────────────────────────────

function costScore(row: QueryLogRow): number {
  const durationScore = Math.min(safeNum(row.query_duration_ms) / 10_000, 1) * 3
  const marksScore    = Math.min(safeNum(row.marks_read)         / 1_000_000, 1) * 3
  const memoryScore   = Math.min(safeNum(row.memory_usage)       / (10 * 1024 ** 3), 1) * 2
  const bytesScore    = Math.min(safeNum(row.read_bytes)         / (10 * 1024 ** 3), 1) * 2
  return Math.round(durationScore + marksScore + memoryScore + bytesScore)
}

function CostBadge({ score }: { score: number }) {
  const color = score >= 7 ? 'text-red-400 border-red-500/30 bg-red-500/10'
    : score >= 4 ? 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10'
    : 'text-green-400 border-green-500/30 bg-green-500/10'
  return (
    <span className={`inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded border ${color} tabular-nums`}>
      ●{score}
    </span>
  )
}

// ─── Thread detail ────────────────────────────────────────────────────────────

function ThreadDetail({ config, queryId }: { config: ConnectionConfig; queryId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['query_threads', queryId],
    queryFn: () => fetchQueryThreadDetail(config, queryId),
    staleTime: 60_000,
    retry: 0,
  })
  if (isLoading) return <div className="text-xs text-ch-muted py-2 animate-pulse">Loading thread data…</div>
  if (error) return (
    <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5 text-[11px] space-y-1">
      <p className="font-medium text-red-400">Query failed: {(error as Error).message}</p>
      <p className="text-ch-muted">This may mean <code className="font-mono text-ch-accent">system.query_thread_log</code> is unavailable or the user lacks SELECT permission on it.</p>
    </div>
  )
  if (!data?.length) return (
    <div className="bg-ch-bg border border-ch-border/60 rounded-lg px-3 py-2.5 text-[11px] text-ch-muted space-y-1">
      <p className="font-medium text-ch-text">No thread data for this query.</p>
      <p>Thread logging must be enabled on the ClickHouse server:</p>
      <code className="block font-mono text-ch-accent bg-ch-surface/60 px-2 py-1 rounded mt-1">
        log_query_threads = 1  <span className="text-ch-muted font-sans">{/* in config.xml / users.xml */}</span>
      </code>
      <p className="text-[10px] mt-1">Without this setting <code className="font-mono">system.query_thread_log</code> is not populated.</p>
    </div>
  )
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[10px]">
        <thead>
          <tr className="text-ch-muted border-b border-ch-border">
            <th className="text-left py-1 pr-3">Thread</th>
            <th className="text-right py-1 pr-3">Real</th>
            <th className="text-right py-1 pr-3">CPU</th>
            <th className="text-right py-1 pr-3">Marks</th>
            <th className="text-right py-1 pr-3">Rows</th>
            <th className="text-right py-1">Memory</th>
          </tr>
        </thead>
        <tbody>
          {(data as QueryThreadRow[]).map((t, i) => {
            const cpuUs = safeNum(t.user_us) + safeNum(t.sys_us)
            return (
              <tr key={i} className="border-b border-ch-border/30 hover:bg-ch-bg/30">
                <td className="py-1 pr-3 text-ch-muted font-mono">{t.thread_name || `thread_${i}`}</td>
                <td className="py-1 pr-3 text-right text-ch-text">{fmtDuration(safeNum(t.real_us) / 1000)}</td>
                <td className="py-1 pr-3 text-right text-ch-text">{fmtDuration(cpuUs / 1000)}</td>
                <td className="py-1 pr-3 text-right text-ch-text">{fmtMarks(safeNum(t.marks_read))}</td>
                <td className="py-1 pr-3 text-right text-ch-text">{fmtRows(safeNum(t.read_rows))}</td>
                <td className="py-1 text-right text-ch-text">{fmtBytes(safeNum(t.memory_usage))}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Cross-shard panel ────────────────────────────────────────────────────────

function CrossShardPanel({
  config,
  queryId,
  clusterName,
}: { config: ConnectionConfig; queryId: string; clusterName: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['cross_shard', queryId, clusterName],
    queryFn: () => fetchCrossShardBreakdown(config, clusterName, queryId),
    staleTime: 120_000,
  })
  if (isLoading) return <div className="text-xs text-ch-muted py-2 animate-pulse">Querying all shards…</div>
  if (error) return (
    <div className="text-xs text-red-400 py-2">
      Failed: {(error as Error).message}. Check clusterAllReplicas access.
    </div>
  )
  if (!data?.length) return <div className="text-xs text-ch-muted py-2">No sub-queries found across shards.</div>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[10px]">
        <thead>
          <tr className="text-ch-muted border-b border-ch-border">
            <th className="text-left py-1 pr-3">Shard</th>
            <th className="text-left py-1 pr-3">Host</th>
            <th className="text-right py-1 pr-3">Duration</th>
            <th className="text-right py-1 pr-3">Marks</th>
            <th className="text-right py-1 pr-3">Rows</th>
            <th className="text-right py-1 pr-3">Memory</th>
            <th className="text-right py-1">Threads</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r, i) => (
            <tr key={i} className="border-b border-ch-border/30 hover:bg-ch-bg/30">
              <td className="py-1 pr-3 text-ch-accent font-mono">#{r._shard_num}</td>
              <td className="py-1 pr-3 text-ch-muted font-mono">{r.host}</td>
              <td className="py-1 pr-3 text-right text-ch-text">{fmtDuration(safeNum(r.query_duration_ms))}</td>
              <td className="py-1 pr-3 text-right text-ch-text">{fmtMarks(safeNum(r.marks_read))}</td>
              <td className="py-1 pr-3 text-right text-ch-text">{fmtRows(safeNum(r.read_rows))}</td>
              <td className="py-1 pr-3 text-right text-ch-text">{fmtBytes(safeNum(r.memory_usage))}</td>
              <td className="py-1 text-right text-ch-text">{safeNum(r.thread_count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Query detail expand panel ────────────────────────────────────────────────

function useCopyToClipboard(text: string, ms = 1500) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), ms)
    })
  }
  return { copied, copy }
}

function tryFormatSql(sql: string): string {
  try {
    return formatSql(sql, { language: 'clickhouse', keywordCase: 'upper', indentStyle: 'standard' })
  } catch {
    return sql
  }
}

function CopyableId({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[10px] font-semibold text-ch-muted uppercase tracking-wider">{label}</span>
      <span className="text-xs font-mono text-ch-text select-all">{value}</span>
      <button
        onClick={handleCopy}
        className="text-ch-muted hover:text-ch-accent transition-colors p-0.5"
        title={`Copy ${label}`}
      >
        {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
      </button>
    </span>
  )
}

function QueryDetailPanel({ row, config }: { row: QueryLogRow; config: ConnectionConfig }) {
  const [showThreads, setShowThreads] = useState(false)
  const [crossShardCluster, setCrossShardCluster] = useState<string | null>(null)
  const [selectedCluster, setSelectedCluster] = useState('')
  const [sqlFormatted, setSqlFormatted] = useState(true)
  const { copied, copy } = useCopyToClipboard(row.query)

  // Load available cluster names for the cross-shard dropdown
  const { data: clusterNodes } = useQuery({
    queryKey: ['clusters_brief', config],
    queryFn: () => fetchClusters(config),
    staleTime: 300_000,
  })
  const clusterNames = [...new Set((clusterNodes ?? []).map(c => c.cluster))].sort()

  const score     = costScore(row)
  const realMs    = safeNum(row.real_time_us) / 1000
  const cpuMs     = (safeNum(row.user_time_us) + safeNum(row.system_time_us)) / 1000
  const parallelism = realMs > 0 ? cpuMs / realMs : 0

  const { data: subQueries } = useQuery({
    queryKey: ['sub_queries', row.query_id],
    queryFn: () => fetchQuerySubQueries(config, row.query_id),
    staleTime: 60_000,
    enabled: true,
  })

  return (
    <div className="bg-ch-bg border-t border-ch-border/50 px-4 py-3 space-y-4">
      {/* Query ID */}
      <div className="flex items-center gap-2 flex-wrap">
        <CopyableId label="Query ID" value={row.query_id} />
        {row.initial_query_id && row.initial_query_id !== row.query_id && (
          <>
            <span className="text-[10px] text-ch-muted">•</span>
            <CopyableId label="Initial" value={row.initial_query_id} />
          </>
        )}
      </div>

      {/* Full query */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-semibold text-ch-muted uppercase tracking-wider">Query</span>
          <div className="flex items-center gap-1.5">
            {/* Format toggle */}
            <div className="flex border border-ch-border rounded-lg overflow-hidden text-[10px]">
              <button
                onClick={() => setSqlFormatted(false)}
                className={`px-2 py-0.5 transition-colors ${!sqlFormatted ? 'bg-ch-accent/10 text-ch-accent' : 'text-ch-muted hover:text-ch-text'}`}
              >Raw</button>
              <button
                onClick={() => setSqlFormatted(true)}
                className={`px-2 py-0.5 transition-colors ${sqlFormatted ? 'bg-ch-accent/10 text-ch-accent' : 'text-ch-muted hover:text-ch-text'}`}
              >Formatted</button>
            </div>
            {/* Copy button */}
            <button
              onClick={copy}
              className="flex items-center gap-1 text-[10px] text-ch-muted hover:text-ch-accent border border-ch-border rounded-lg px-2 py-0.5 transition-colors"
            >
              {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
        <pre className="text-[10px] font-mono text-ch-accent leading-relaxed whitespace-pre-wrap break-all bg-ch-surface/50 rounded-lg p-3 border border-ch-border/50 max-h-64 overflow-y-auto">
          {sqlFormatted ? tryFormatSql(row.query) : row.query}
        </pre>
        {row.exception && (
          <div className="mt-2 p-2.5 bg-red-500/8 border border-red-500/20 rounded-lg text-[10px] text-red-300 leading-relaxed">
            <span className="font-semibold text-red-400">Exception: </span>{row.exception}
          </div>
        )}
      </div>

      {/* Cost breakdown grid */}
      <div>
        <div className="text-[10px] font-semibold text-ch-muted uppercase tracking-wider mb-2">
          Cost breakdown — score {score}/10
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: 'Duration',     value: fmtDuration(safeNum(row.query_duration_ms)),  sub: null },
            { label: 'Marks read',   value: fmtMarks(safeNum(row.marks_read)),            sub: safeNum(row.result_rows) > 0 ? `${(safeNum(row.marks_read) / safeNum(row.result_rows)).toFixed(0)} marks/result-row` : null },
            { label: 'Memory',       value: fmtBytes(safeNum(row.memory_usage)),          sub: 'peak at completion' },
            { label: 'Read bytes',   value: fmtBytes(safeNum(row.read_bytes)),            sub: null },
            { label: 'CPU time',     value: fmtDuration(cpuMs),                          sub: null },
            { label: 'Wall time',    value: fmtDuration(realMs),                         sub: null },
            { label: 'Parallelism',  value: `${parallelism.toFixed(2)}×`,               sub: parallelism < 0.5 ? 'I/O bound' : parallelism < 1.2 ? 'low parallel' : 'good' },
            { label: 'Threads',      value: String(safeNum(row.thread_count) || '—'),    sub: null },
          ].map(item => (
            <div key={item.label} className="bg-ch-surface border border-ch-border rounded-lg px-2.5 py-2">
              <div className="text-[9px] text-ch-muted uppercase tracking-wider">{item.label}</div>
              <div className="text-xs font-semibold text-ch-text mt-0.5">{item.value}</div>
              {item.sub && <div className="text-[9px] text-ch-muted mt-0.5">{item.sub}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Sub-queries (Tier 1 — local) */}
      {subQueries && subQueries.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold text-ch-muted uppercase tracking-wider mb-2">
            Local sub-queries ({subQueries.length})
          </div>
          <div className="space-y-1">
            {subQueries.map(sq => (
              <div key={sq.query_id} className="flex items-center gap-3 text-[10px] bg-ch-surface border border-ch-border rounded-lg px-3 py-2">
                <span className="text-ch-muted font-mono truncate flex-1">{sq.query_id}</span>
                <span className="text-ch-text">{fmtDuration(safeNum(sq.query_duration_ms))}</span>
                <span className="text-ch-text">{fmtMarks(safeNum(sq.marks_read))} marks</span>
                <span className="text-ch-text">{fmtBytes(safeNum(sq.memory_usage))}</span>
              </div>
            ))}
          </div>
          <p className="text-[9px] text-ch-muted mt-1">
            Sub-queries that ran on this node only. Remote shard sub-queries require cross-shard lookup below.
          </p>
        </div>
      )}

      {/* Thread detail (Tier 2 — lazy) */}
      <div>
        <button
          onClick={() => setShowThreads(v => !v)}
          className="flex items-center gap-2 text-[10px] text-ch-muted hover:text-ch-text transition-colors"
        >
          {showThreads
            ? <ChevronDown className="w-3 h-3" />
            : <ChevronRight className="w-3 h-3" />
          }
          <span className="font-semibold uppercase tracking-wider">Thread detail</span>
        </button>
        {showThreads && (
          <div className="mt-2">
            <ThreadDetail config={config} queryId={row.query_id} />
          </div>
        )}
      </div>

      {/* Cross-shard breakdown (Tier 3 — opt-in) */}
      <div>
        <div className="text-[10px] font-semibold text-ch-muted uppercase tracking-wider mb-1">
          Cross-shard breakdown
        </div>
        <p className="text-[10px] text-ch-muted mb-2 leading-relaxed">
          Queries <code className="font-mono text-ch-accent">system.query_log</code> on <em>every node</em> of a cluster
          via <code className="font-mono text-ch-accent">clusterAllReplicas()</code> to show how work was distributed
          across shards. Only useful for queries that fanned out to multiple shards (e.g. queries on a Distributed table).
        </p>
        {crossShardCluster === null ? (
          <div className="flex items-center gap-2">
            {clusterNames.length > 0 ? (
              <select
                value={selectedCluster}
                onChange={e => setSelectedCluster(e.target.value)}
                className="bg-ch-bg border border-ch-border rounded-lg px-3 py-1.5 text-xs text-ch-text focus:outline-none focus:border-ch-accent/60 flex-1 max-w-xs"
              >
                <option value="">Select cluster…</option>
                {clusterNames.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                placeholder="Cluster name (e.g. my_cluster)…"
                value={selectedCluster}
                onChange={e => setSelectedCluster(e.target.value)}
                className="bg-ch-bg border border-ch-border rounded-lg px-3 py-1.5 text-xs text-ch-text placeholder:text-ch-muted focus:outline-none focus:border-ch-accent/60 w-56"
              />
            )}
            <button
              onClick={() => { if (selectedCluster.trim()) setCrossShardCluster(selectedCluster.trim()) }}
              disabled={!selectedCluster.trim()}
              className="text-xs text-ch-accent border border-ch-accent/30 rounded-lg px-2.5 py-1.5 hover:bg-ch-accent/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Query all shards
            </button>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] text-ch-muted">Cluster: <code className="font-mono text-ch-accent">{crossShardCluster}</code></span>
              <button onClick={() => setCrossShardCluster(null)} className="text-[10px] text-ch-muted hover:text-ch-text transition-colors">
                <X className="w-3 h-3" />
              </button>
            </div>
            <CrossShardPanel config={config} queryId={row.query_id} clusterName={crossShardCluster} />
          </div>
        )}
      </div>
    </div>
  )
}

// ─── System query classifier ──────────────────────────────────────────────────

const SYSTEM_DB_PREFIXES = ['system.', 'information_schema.', '.inner.']

function isSystemQuery(row: QueryLogRow): boolean {
  const tables = row.tables ?? []
  if (tables.length > 0) {
    return tables.every(t =>
      SYSTEM_DB_PREFIXES.some(p => t.toLowerCase().startsWith(p))
    )
  }
  const q = row.query.trim()
  return (
    /^\s*(select\s+1|select\s+version|select\s+now|show\s|set\s)/i.test(q) ||
    /from\s+system\./i.test(q) ||
    /from\s+information_schema\./i.test(q)
  )
}

function tableDisplay(tables: string[]): string {
  if (!tables?.length) return ''
  // Strip database prefix for brevity: "mydb.clicks" → "clicks"
  const names = tables.map(t => t.includes('.') ? t.split('.').pop()! : t)
  if (names.length > 2) return `${names.slice(0, 2).join(', ')} +${names.length - 2}`
  return names.join(', ')
}

// ─── Query list row ───────────────────────────────────────────────────────────

type ColWidths = { tables: number; time: number; duration: number }

function QueryRow({
  row, config, index, colWidths,
}: {
  row: QueryLogRow; config: ConnectionConfig; index: number; colWidths: ColWidths
}) {
  const [expanded, setExpanded] = useState(false)
  const score   = costScore(row)
  const isError = row.type !== 'QueryFinish'
  const isSys   = isSystemQuery(row)
  const tables  = tableDisplay(row.tables ?? [])
  const zebra   = index % 2 === 1 ? 'bg-ch-surface/20' : ''
  const leftBorder = isError
    ? 'border-l-2 border-l-red-500/60'
    : score >= 7 ? 'border-l-2 border-l-red-500/40'
    : score >= 4 ? 'border-l-2 border-l-yellow-500/30'
    : ''

  return (
    <div className={`border-b border-ch-border/20 transition-colors ${zebra} ${leftBorder} hover:bg-ch-accent/5`}>
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-0 px-4 py-2.5 text-left"
      >
        {/* Query — flex-1, takes remaining space, right-padded */}
        <span className="text-[11px] text-ch-text font-mono truncate flex-1 min-w-0 pr-3">
          {row.query.trimStart().slice(0, 200)}
        </span>

        {/* Tables */}
        <span
          className="text-[10px] text-ch-muted flex-shrink-0 truncate pr-3"
          style={{ width: colWidths.tables }}
          title={(row.tables ?? []).join(', ')}
        >
          {tables || <span className="text-ch-border/60">—</span>}
        </span>

        {/* Time — full timestamp */}
        <span
          className="text-[10px] text-ch-muted font-mono flex-shrink-0 tabular-nums pr-3"
          style={{ width: colWidths.time }}
        >
          {row.event_time}
        </span>

        {/* Duration */}
        <span
          className="text-[11px] font-mono text-ch-text flex-shrink-0 text-right tabular-nums pr-2"
          style={{ width: colWidths.duration }}
        >
          {fmtDuration(safeNum(row.query_duration_ms))}
        </span>

        {/* Badges — fixed width so alignment is constant */}
        <span className="w-16 flex-shrink-0 flex items-center gap-1 justify-end">
          {isSys && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-ch-border/40 text-ch-muted border border-ch-border/60 font-medium leading-none">
              SYS
            </span>
          )}
          {isError && (
            <span className="text-[9px] px-1 py-0.5 rounded border bg-red-500/15 text-red-400 border-red-500/25 leading-none">
              ERR
            </span>
          )}
        </span>

        {/* Expand chevron */}
        {expanded
          ? <ChevronDown className="w-3 h-3 text-ch-muted flex-shrink-0" />
          : <ChevronRight className="w-3 h-3 text-ch-muted flex-shrink-0" />
        }
      </button>
      {expanded && <QueryDetailPanel row={row} config={config} />}
    </div>
  )
}

// ─── Hotspots view ────────────────────────────────────────────────────────────

function HotspotsView({ config }: { config: ConnectionConfig }) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['table_hotspots', config],
    queryFn: () => fetchTableHotspots(config),
    staleTime: 60_000,
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-ch-muted">Tables hit most in the last hour</p>
        <button onClick={() => refetch()} className="text-xs text-ch-muted hover:text-ch-text transition-colors">
          <RefreshCw className={`w-3 h-3 inline mr-1 ${isLoading ? 'animate-spin' : ''}`} />Refresh
        </button>
      </div>
      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-8 bg-ch-surface rounded animate-pulse" />)}</div>
      ) : !data?.length ? (
        <p className="text-xs text-ch-muted py-8 text-center">No query activity in the last hour.</p>
      ) : (
        <div className="border border-ch-border rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-ch-surface border-b border-ch-border">
              <tr>
                {['Table', 'Queries', 'Total Duration', 'Rows Read', 'Bytes Read'].map(h => (
                  <th key={h} className="text-left px-4 py-2 text-ch-muted font-medium text-[10px] uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr key={i} className="border-b border-ch-border/30 hover:bg-ch-bg/30">
                  <td className="px-4 py-2 font-mono text-ch-accent text-[11px]">{row.table_name}</td>
                  <td className="px-4 py-2 text-ch-text font-semibold">{row.query_count}</td>
                  <td className="px-4 py-2 text-ch-muted">{fmtDuration(safeNum(row.total_duration_ms))}</td>
                  <td className="px-4 py-2 text-ch-muted">{fmtRows(safeNum(row.total_rows_read))}</td>
                  <td className="px-4 py-2 text-ch-muted">{fmtBytes(safeNum(row.total_bytes_read))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Multi-select dropdown ────────────────────────────────────────────────────

interface MultiSelectProps {
  label: string
  options: string[]
  selected: string[]
  onChange: (vals: string[]) => void
  loading?: boolean
}

function MultiSelect({ label, options, selected, onChange, loading }: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const shown = q ? options.filter(o => o.toLowerCase().includes(q.toLowerCase())) : options
  const allShownSelected = shown.length > 0 && shown.every(o => selected.includes(o))

  function toggle(val: string) {
    onChange(selected.includes(val) ? selected.filter(s => s !== val) : [...selected, val])
  }
  function toggleAll() {
    if (allShownSelected) onChange(selected.filter(s => !shown.includes(s)))
    else onChange([...new Set([...selected, ...shown])])
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors font-medium ${
          selected.length > 0
            ? 'bg-ch-accent/10 border-ch-accent/40 text-ch-accent'
            : 'border-ch-border text-ch-muted hover:text-ch-text hover:border-ch-border/80'
        }`}
      >
        <span>{label}</span>
        {selected.length > 0 && (
          <span className="bg-ch-accent/20 text-ch-accent text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
            {selected.length}
          </span>
        )}
        <ChevronDown className={`w-3 h-3 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-2 min-w-[340px] bg-ch-surface border border-ch-border rounded-xl shadow-2xl z-20 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="px-3 pt-3 pb-2 border-b border-ch-border space-y-2">
              <input
                type="text"
                placeholder={`Search ${label.toLowerCase()}…`}
                value={q}
                onChange={e => setQ(e.target.value)}
                className="w-full bg-ch-bg border border-ch-border rounded-lg px-3 py-1.5 text-xs text-ch-text placeholder:text-ch-muted focus:outline-none focus:border-ch-accent/50"
                autoFocus
              />
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-ch-muted">
                  {loading ? 'Loading…' : `${shown.length} option${shown.length !== 1 ? 's' : ''}`}
                  {selected.length > 0 && <span className="text-ch-accent ml-1">· {selected.length} selected</span>}
                </span>
                <div className="flex items-center gap-3">
                  {shown.length > 0 && !loading && (
                    <button
                      onClick={toggleAll}
                      className="text-[11px] text-ch-accent hover:text-ch-accent/80 font-medium transition-colors"
                    >
                      {allShownSelected ? 'Deselect all' : 'Select all'}
                    </button>
                  )}
                  {selected.length > 0 && (
                    <button
                      onClick={() => onChange([])}
                      className="text-[11px] text-ch-muted hover:text-red-400 transition-colors"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Options list */}
            <div className="max-h-60 overflow-y-auto">
              {loading ? (
                <div className="px-3 py-4 space-y-2">
                  {[1,2,3].map(i => <div key={i} className="h-4 bg-ch-bg rounded animate-pulse" />)}
                </div>
              ) : shown.length === 0 ? (
                <p className="px-3 py-4 text-[11px] text-ch-muted text-center">
                  {q ? `No ${label.toLowerCase()} matching "${q}"` : `No ${label.toLowerCase()} found in this time range.`}
                </p>
              ) : (
                shown.map(opt => {
                  const isSelected = selected.includes(opt)
                  return (
                    <label
                      key={opt}
                      className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors border-b border-ch-border/20 last:border-0 ${
                        isSelected ? 'bg-ch-accent/5' : 'hover:bg-ch-bg/60'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggle(opt)}
                        className="accent-ch-accent flex-shrink-0 w-3.5 h-3.5"
                      />
                      <span
                        className={`text-[11px] font-mono flex-1 ${isSelected ? 'text-ch-accent' : 'text-ch-text'}`}
                        title={opt}
                      >
                        {opt}
                      </span>
                    </label>
                  )
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Exclude patterns (localStorage-persisted) ────────────────────────────────

const EXCLUDE_KEY = 'ch-query-exclude-patterns'

function loadPatterns(): string[] {
  try { return JSON.parse(localStorage.getItem(EXCLUDE_KEY) ?? '[]') }
  catch { return [] }
}

function savePatterns(patterns: string[]) {
  localStorage.setItem(EXCLUDE_KEY, JSON.stringify(patterns))
}

interface ExcludeProps {
  patterns: string[]
  onAdd: (p: string) => void
  onRemove: (p: string) => void
}

function ExcludeDropdown({ patterns, onAdd, onRemove }: ExcludeProps) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')

  function submit() {
    const v = input.trim()
    if (v && !patterns.includes(v)) onAdd(v)
    setInput('')
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
          patterns.length > 0
            ? 'bg-orange-500/10 border-orange-500/30 text-orange-400'
            : 'border-ch-border text-ch-muted hover:text-ch-text'
        }`}
        title="Exclude queries whose text matches any of these patterns"
      >
        <SlidersHorizontal className="w-3 h-3" />
        Exclude{patterns.length > 0 ? ` (${patterns.length})` : ''}
      </button>

      {open && (
        <>
          {/* backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1.5 w-80 bg-ch-surface border border-ch-border rounded-xl shadow-2xl z-20 p-3 space-y-3">
            <div>
              <p className="text-[10px] font-semibold text-ch-muted uppercase tracking-wider mb-0.5">
                Exclude query patterns
              </p>
              <p className="text-[10px] text-ch-muted leading-relaxed">
                Substring match, case-insensitive. Saved per browser. Use to hide noisy recurring patterns like monitoring queries.
              </p>
            </div>

            {/* Always-excluded notice */}
            <div className="bg-ch-bg border border-ch-border/60 rounded-lg px-2.5 py-2">
              <p className="text-[10px] text-ch-muted font-medium mb-1">Always excluded (server-side)</p>
              {['DESC / DESCRIBE'].map(p => (
                <div key={p} className="flex items-center gap-2 py-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-ch-border flex-shrink-0" />
                  <code className="text-[10px] font-mono text-ch-muted">{p}</code>
                </div>
              ))}
            </div>

            {/* User-defined patterns */}
            <div>
              <p className="text-[10px] text-ch-muted font-medium mb-1.5">Custom patterns</p>
              {patterns.length === 0 ? (
                <p className="text-[10px] text-ch-muted italic">No patterns yet.</p>
              ) : (
                <div className="space-y-1 mb-2">
                  {patterns.map(p => (
                    <div key={p} className="flex items-center gap-2 bg-ch-bg border border-ch-border/60 rounded-lg px-2.5 py-1.5">
                      <code className="text-[11px] font-mono text-ch-accent flex-1 truncate" title={p}>{p}</code>
                      <button
                        onClick={() => onRemove(p)}
                        className="text-ch-muted hover:text-red-400 transition-colors flex-shrink-0"
                        title="Remove"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add input */}
              <div className="flex gap-1.5 mt-2">
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submit() }}
                  placeholder="e.g. watermark, SELECT 1, ping"
                  className="bg-ch-bg border border-ch-border rounded-lg px-2.5 py-1.5 text-xs text-ch-text placeholder:text-ch-muted focus:outline-none focus:border-ch-accent/60 flex-1 min-w-0"
                />
                <button
                  onClick={submit}
                  disabled={!input.trim()}
                  className="flex items-center gap-1 text-xs text-ch-accent border border-ch-accent/30 rounded-lg px-2.5 py-1.5 hover:bg-ch-accent/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                >
                  <Plus className="w-3 h-3" /> Add
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

type View = 'queries' | 'hotspots'
type Interval = 5 | 10 | 15 | 30 | 60 | 360 | 1440
type Limit = 100 | 200 | 500
type SortCol = 'event_time' | 'query_duration_ms' | 'user' | 'query' | 'tables'

const DEFAULT_COL_WIDTHS: ColWidths = { tables: 260, time: 148, duration: 88 }

export function QueryLogViewer({ config, filterQueryId, onClearFilter }: Props) {
  const [intervalMinutes, setIntervalMinutes] = useState<Interval>(60)
  const [limit, setLimit]                     = useState<Limit>(200)
  const [autoRefresh, setAutoRefresh]         = useState(false)
  const [errorsOnly, setErrorsOnly]       = useState(false)
  const [hideSystem, setHideSystem]       = useState(true)
  const [view, setView]                   = useState<View>('queries')
  const [excludePatterns, setExcludePatterns] = useState<string[]>(loadPatterns)
  // Server-side multiselect filters
  const [dbSelections, setDbSelections]       = useState<string[]>([])
  const [tableSelections, setTableSelections] = useState<string[]>([])
  // Server-side search (query text substring, apply on Enter/blur)
  const [searchInput, setSearchInput]   = useState('')
  const [searchFilter, setSearchFilter] = useState('')
  const [queryIdInput, setQueryIdInput] = useState('')
  const [queryIdFilter, setQueryIdFilter] = useState('')
  // Sorting
  const [sortCol, setSortCol] = useState<SortCol>('event_time')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  // Resizable column widths (px); query column stays flex-1
  const [colWidths, setColWidths] = useState<ColWidths>(DEFAULT_COL_WIDTHS)

  // Clear multiselects when time window changes (available options will differ)
  useEffect(() => { setDbSelections([]); setTableSelections([]) }, [intervalMinutes])

  function applySearch() { setSearchFilter(searchInput.trim()) }
  function applyQueryId() { setQueryIdFilter(queryIdInput.trim()) }

  function toggleSort(col: SortCol) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  const startResize = useCallback((col: keyof ColWidths, startX: number) => {
    const startWidth = colWidths[col]
    function onMove(e: MouseEvent) {
      setColWidths(prev => ({ ...prev, [col]: Math.max(50, startWidth + (e.clientX - startX)) }))
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [colWidths])

  function addPattern(p: string) {
    const next = [...excludePatterns, p]
    setExcludePatterns(next)
    savePatterns(next)
  }
  function removePattern(p: string) {
    const next = excludePatterns.filter(x => x !== p)
    setExcludePatterns(next)
    savePatterns(next)
  }

  // Dropdown filter options from ClickHouse
  const { data: filterOptions, isLoading: optionsLoading } = useQuery({
    queryKey: ['ql_filter_options', config, intervalMinutes],
    queryFn: () => fetchQueryLogFilterOptions(config!, intervalMinutes),
    enabled: !!config,
    staleTime: 60_000,
  })
  const dbOptions    = filterOptions?.databases ?? []
  const tableOptions = filterOptions?.tables    ?? []

  const { data, isLoading, isFetching, refetch, dataUpdatedAt, error } =
    useQueryLog(config, intervalMinutes, limit, excludePatterns, dbSelections, tableSelections, searchFilter, autoRefresh ? 30_000 : false, queryIdFilter)

  // When coming from Process Monitor, do a direct server-side lookup by query_id
  // (bypasses time window + row limit — the query may be outside those bounds or still running)
  const {
    data: directRows,
    isLoading: directLoading,
    isFetching: directFetching,
  } = useQuery({
    queryKey: ['query_by_id', config, filterQueryId],
    queryFn: () => fetchQueryById(config!, filterQueryId!),
    enabled: !!config && !!filterQueryId,
    staleTime: 10_000,
    refetchInterval: (query) => query.state.data?.length ? false : 5_000,  // stop once found
  })

  const rows = data ?? []

  // Client-side filters + sort (server handles excludePatterns, db, table, searchFilter)
  const filtered = useMemo(() => {
    // When filterQueryId is active, use the direct lookup result instead of the normal list
    if (filterQueryId) {
      return [...(directRows ?? [])].sort((a, b) => {
        const av = safeNum((a as unknown as Record<string, unknown>)[sortCol])
        const bv = safeNum((b as unknown as Record<string, unknown>)[sortCol])
        const cmp = isNaN(av) ? a[sortCol as keyof typeof a]!.toString().localeCompare(b[sortCol as keyof typeof b]!.toString()) : av - bv
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    let r = rows
    if (hideSystem) r = r.filter(x => !isSystemQuery(x))
    if (errorsOnly) r = r.filter(x => x.type !== 'QueryFinish')
    r = [...r].sort((a, b) => {
      let cmp: number
      if (sortCol === 'user')        cmp = a.user.localeCompare(b.user)
      else if (sortCol === 'query')  cmp = a.query.localeCompare(b.query)
      else if (sortCol === 'tables') cmp = (a.tables ?? []).join(',').localeCompare((b.tables ?? []).join(','))
      else {
        const av = safeNum((a as unknown as Record<string, unknown>)[sortCol])
        const bv = safeNum((b as unknown as Record<string, unknown>)[sortCol])
        cmp = av - bv
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return r
  }, [rows, directRows, hideSystem, errorsOnly, filterQueryId, sortCol, sortDir])

  // Summary stats
  const systemCount = rows.filter(isSystemQuery).length
  const totalErrors = filtered.filter(r => r.type !== 'QueryFinish').length
  const p95 = useMemo(() => {
    if (!filtered.length) return 0
    const sorted = [...filtered].map(r => safeNum(r.query_duration_ms)).sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length * 0.95)] ?? 0
  }, [filtered])

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : null

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Toolbar — row 1: time range, limits, slow threshold, search */}
      <div className="flex flex-wrap items-center gap-2 px-6 py-2.5 border-b border-ch-border/50 bg-ch-surface/50 flex-shrink-0">
        <select
          value={intervalMinutes}
          onChange={e => setIntervalMinutes(Number(e.target.value) as Interval)}
          className="bg-ch-bg border border-ch-border rounded-lg px-2 py-1.5 text-xs text-ch-text focus:outline-none focus:border-ch-accent/60"
        >
          <option value={5}>Last 5m</option>
          <option value={10}>Last 10m</option>
          <option value={15}>Last 15m</option>
          <option value={30}>Last 30m</option>
          <option value={60}>Last 1h</option>
          <option value={360}>Last 6h</option>
          <option value={1440}>Last 24h</option>
        </select>
        <select
          value={limit}
          onChange={e => setLimit(Number(e.target.value) as Limit)}
          className="bg-ch-bg border border-ch-border rounded-lg px-2 py-1.5 text-xs text-ch-text focus:outline-none focus:border-ch-accent/60"
        >
          <option value={100}>100 rows</option>
          <option value={200}>200 rows</option>
          <option value={500}>500 rows</option>
        </select>
        <div className={`flex items-center gap-1.5 border rounded-lg px-3 py-1.5 flex-1 min-w-32 transition-colors ${searchFilter ? 'border-ch-accent/40 bg-ch-accent/5' : 'border-ch-border bg-ch-bg'}`}>
          <input
            type="text"
            placeholder="Search query text (Enter to apply)…"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') applySearch() }}
            onBlur={applySearch}
            className="bg-transparent text-xs text-ch-text placeholder:text-ch-muted focus:outline-none flex-1 min-w-0"
          />
          {searchFilter && (
            <button onClick={() => { setSearchInput(''); setSearchFilter('') }} className="text-ch-muted hover:text-red-400 transition-colors flex-shrink-0">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <div className={`flex items-center gap-1.5 border rounded-lg px-3 py-1.5 min-w-48 transition-colors ${queryIdFilter ? 'border-blue-400/40 bg-blue-400/5' : 'border-ch-border bg-ch-bg'}`}>
          <input
            type="text"
            placeholder="Query ID / trace-id (LIKE)…"
            value={queryIdInput}
            onChange={e => setQueryIdInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') applyQueryId() }}
            onBlur={applyQueryId}
            className="bg-transparent text-xs text-ch-text placeholder:text-ch-muted focus:outline-none flex-1 min-w-0"
          />
          {queryIdFilter && (
            <button onClick={() => { setQueryIdInput(''); setQueryIdFilter('') }} className="text-ch-muted hover:text-red-400 transition-colors flex-shrink-0">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <button
          onClick={() => setHideSystem(v => !v)}
          className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
            hideSystem ? 'bg-ch-accent/10 border-ch-accent/30 text-ch-accent' : 'border-ch-border text-ch-muted hover:text-ch-text'
          }`}
          title="Hide monitoring, system.* queries and internal queries"
        >
          <Filter className="w-3 h-3" /> Hide system
        </button>
        <button
          onClick={() => setErrorsOnly(v => !v)}
          className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
            errorsOnly ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'border-ch-border text-ch-muted hover:text-ch-text'
          }`}
        >
          <AlertCircle className="w-3 h-3" /> Errors only
        </button>
        <ExcludeDropdown
          patterns={excludePatterns}
          onAdd={addPattern}
          onRemove={removePattern}
        />
        {/* View switcher */}
        <div className="flex border border-ch-border rounded-lg overflow-hidden ml-auto">
          {(['queries', 'hotspots'] as View[]).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`text-xs px-3 py-1.5 capitalize transition-colors ${
                view === v ? 'bg-ch-accent/10 text-ch-accent' : 'text-ch-muted hover:text-ch-text'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 text-xs text-ch-muted border border-ch-border rounded-lg px-2.5 py-1.5 hover:text-ch-text hover:border-ch-accent/30 transition-colors"
        >
          <RefreshCw className={`w-3 h-3 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
        </button>
        <button
          onClick={() => setAutoRefresh(v => !v)}
          title={autoRefresh ? 'Auto-refresh on (30s) — click to disable' : 'Auto-refresh off — click to enable (30s)'}
          className={`flex items-center gap-1.5 text-xs border rounded-lg px-2.5 py-1.5 transition-colors ${
            autoRefresh
              ? 'bg-green-500/10 border-green-500/30 text-green-400 hover:bg-green-500/20'
              : 'border-ch-border text-ch-muted hover:text-ch-text'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${autoRefresh ? 'bg-green-400 animate-pulse' : 'bg-ch-border'}`} />
          {autoRefresh ? 'Live' : 'Paused'}
        </button>
      </div>

      {/* Toolbar — row 2: server-side multiselect filters */}
      <div className="flex flex-wrap items-center gap-2 px-6 py-2 border-b border-ch-border bg-ch-bg/30 flex-shrink-0">
        <span className="text-[10px] text-ch-muted uppercase tracking-wider font-semibold flex-shrink-0">Filter by:</span>
        <MultiSelect
          label="Database"
          options={dbOptions}
          selected={dbSelections}
          onChange={setDbSelections}
          loading={optionsLoading}
        />
        <MultiSelect
          label="Table"
          options={tableOptions}
          selected={tableSelections}
          onChange={setTableSelections}
          loading={optionsLoading}
        />
        <span className="text-[10px] text-ch-muted">Sent to ClickHouse as IN clause</span>
        {(dbSelections.length > 0 || tableSelections.length > 0) && (
          <button
            onClick={() => { setDbSelections([]); setTableSelections([]) }}
            className="text-[10px] text-red-400 hover:text-red-300 border border-red-500/30 rounded-lg px-2 py-1 transition-colors ml-auto"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Filter banner */}
      {filterQueryId && (
        <div className="flex items-center gap-2 px-6 py-2 bg-ch-accent/8 border-b border-ch-accent/20 text-xs flex-shrink-0">
          <Filter className="w-3.5 h-3.5 text-ch-accent flex-shrink-0" />
          <span className="text-ch-muted">Direct lookup for query</span>
          <code className="text-ch-accent font-mono truncate flex-1">{filterQueryId}</code>
          {directFetching && <Loader2 className="w-3 h-3 animate-spin text-ch-muted flex-shrink-0" />}
          <button onClick={onClearFilter} className="text-ch-muted hover:text-ch-text transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-2 px-6 py-3 bg-red-500/10 border-b border-red-500/20 text-red-400 text-xs flex-shrink-0">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <span className="font-semibold">Query failed: </span>
            <span className="break-all">{(error as Error).message}</span>
          </div>
        </div>
      )}

      {/* Summary bar */}
      <div className="flex items-center gap-6 px-6 py-2.5 border-b border-ch-border bg-ch-surface/30 flex-shrink-0 text-xs">
        <span className="text-ch-muted">
          Showing <span className="text-ch-text font-semibold">{filtered.length}</span>
          {!filterQueryId && rows.length >= limit && (
            <span
              className="ml-1.5 text-yellow-400"
              title={`Results capped at ${limit}. Reduce the time window or increase the limit to see more.`}
            >
              ⚠ {limit} limit reached
            </span>
          )}
        </span>
        {hideSystem && systemCount > 0 && (
          <span className="text-ch-muted">{systemCount} system hidden</span>
        )}
        {excludePatterns.length > 0 && (
          <span className="text-orange-400/80">{excludePatterns.length} pattern{excludePatterns.length > 1 ? 's' : ''} excluded (server-side)</span>
        )}
        {totalErrors > 0 && (
          <span className="text-red-400"><span className="font-semibold">{totalErrors}</span> errors</span>
        )}
        <span className="text-ch-muted">p95 <span className="text-ch-text font-semibold">{fmtDuration(p95)}</span></span>
        {lastUpdated && <span className="text-ch-muted ml-auto">fetched {lastUpdated}</span>}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {filterQueryId && directLoading ? (
          <div className="space-y-2 p-6">
            {[1,2,3].map(i => <div key={i} className="h-10 bg-ch-surface rounded animate-pulse" />)}
          </div>
        ) : filterQueryId && !directLoading && filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-center px-6">
            <div className="w-10 h-10 rounded-full bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center">
              <Loader2 className="w-5 h-5 text-yellow-400 animate-spin" />
            </div>
            <p className="text-sm font-medium text-ch-text">Query not in log yet</p>
            <p className="text-xs text-ch-muted max-w-sm">
              This query is likely still running. The entry will appear in <code className="font-mono text-ch-accent">system.query_log</code> once it completes.
              Checking every 5 seconds…
            </p>
            <p className="text-[10px] text-ch-muted font-mono truncate max-w-sm">{filterQueryId}</p>
          </div>
        ) : !filterQueryId && isLoading ? (
          <div className="space-y-2 p-6">
            {[1,2,3,4,5].map(i => <div key={i} className="h-10 bg-ch-surface rounded animate-pulse" />)}
          </div>
        ) : error ? null
        : !filterQueryId && rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-center px-6">
            <Zap className="w-8 h-8 text-ch-muted" />
            <p className="text-sm font-medium text-ch-text">No queries found in the last {intervalMinutes < 60 ? `${intervalMinutes}m` : `${intervalMinutes / 60}h`}</p>
            <p className="text-xs text-ch-muted">
              Check that <code className="font-mono text-ch-accent">log_queries = 1</code> is set on this server.
            </p>
          </div>
        ) : view === 'queries' ? (
          <div>
            {/* Column headers — gap-0 + pr-N padding matches row cells exactly */}
            <div className="flex items-center gap-0 px-4 py-2 bg-ch-surface border-b border-ch-border text-[10px] text-ch-muted uppercase tracking-wider sticky top-0 z-10 shadow-sm select-none">
              {/* Query — flex-1, sortable */}
              <button
                onClick={() => toggleSort('query')}
                className={`flex-1 flex items-center gap-1 hover:text-ch-text transition-colors min-w-0 pr-3 ${sortCol === 'query' ? 'text-ch-accent font-semibold' : 'font-semibold'}`}
              >
                Query
                {sortCol === 'query'
                  ? sortDir === 'desc' ? <ArrowDown className="w-2.5 h-2.5 flex-shrink-0" /> : <ArrowUp className="w-2.5 h-2.5 flex-shrink-0" />
                  : <ChevronsUpDown className="w-2.5 h-2.5 opacity-40 flex-shrink-0" />
                }
              </button>

              {/* Tables — sortable + resizable */}
              <div className="relative flex-shrink-0 flex items-center pr-3" style={{ width: colWidths.tables }}>
                <button
                  onClick={() => toggleSort('tables')}
                  className={`flex items-center gap-1 hover:text-ch-text transition-colors flex-1 min-w-0 ${sortCol === 'tables' ? 'text-ch-accent font-semibold' : 'font-semibold'}`}
                >
                  Tables
                  {sortCol === 'tables'
                    ? sortDir === 'desc' ? <ArrowDown className="w-2.5 h-2.5 flex-shrink-0" /> : <ArrowUp className="w-2.5 h-2.5 flex-shrink-0" />
                    : <ChevronsUpDown className="w-2.5 h-2.5 opacity-40 flex-shrink-0" />
                  }
                </button>
                <div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-ch-accent/50 transition-colors rounded" onMouseDown={e => { e.preventDefault(); startResize('tables', e.clientX) }} />
              </div>

              {/* Timestamp — sortable + resizable */}
              <div className="relative flex-shrink-0 flex items-center pr-3" style={{ width: colWidths.time }}>
                <button
                  onClick={() => toggleSort('event_time')}
                  className={`flex items-center gap-1 hover:text-ch-text transition-colors flex-1 ${sortCol === 'event_time' ? 'text-ch-accent font-semibold' : ''}`}
                >
                  Timestamp
                  {sortCol === 'event_time'
                    ? sortDir === 'desc' ? <ArrowDown className="w-2.5 h-2.5 flex-shrink-0" /> : <ArrowUp className="w-2.5 h-2.5 flex-shrink-0" />
                    : <ChevronsUpDown className="w-2.5 h-2.5 opacity-40 flex-shrink-0" />
                  }
                </button>
                <div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-ch-accent/50 transition-colors rounded" onMouseDown={e => { e.preventDefault(); startResize('time', e.clientX) }} />
              </div>

              {/* Duration — sortable + resizable */}
              <div className="relative flex-shrink-0 flex items-center justify-end pr-2" style={{ width: colWidths.duration }}>
                <button
                  onClick={() => toggleSort('query_duration_ms')}
                  className={`flex items-center gap-1 hover:text-ch-text transition-colors ${sortCol === 'query_duration_ms' ? 'text-ch-accent font-semibold' : ''}`}
                >
                  {sortCol === 'query_duration_ms'
                    ? sortDir === 'desc' ? <ArrowDown className="w-2.5 h-2.5 flex-shrink-0" /> : <ArrowUp className="w-2.5 h-2.5 flex-shrink-0" />
                    : <ChevronsUpDown className="w-2.5 h-2.5 opacity-40 flex-shrink-0" />
                  }
                  Duration
                </button>
                <div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-ch-accent/50 transition-colors rounded" onMouseDown={e => { e.preventDefault(); startResize('duration', e.clientX) }} />
              </div>

              {/* Matches badge container + chevron in rows */}
              <span className="w-16 flex-shrink-0" />
              <span className="w-3 flex-shrink-0" />
            </div>
            {filtered.map((row, i) => (
              <QueryRow key={row.query_id} row={row} config={config} index={i} colWidths={colWidths} />
            ))}
          </div>
        ) : (
          <div className="p-6"><HotspotsView config={config} /></div>
        )}
      </div>
    </div>
  )
}
