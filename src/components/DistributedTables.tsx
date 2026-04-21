import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Database, ChevronDown, ChevronRight, Share2, Server, HardDrive,
  Layers, Tag, ArrowUpDown, Calendar, Hash, FileText, Search, Pin, PinOff,
} from 'lucide-react'
import { fetchTableColumns } from '../api/clickhouse'
import { usePinnedTables } from '../hooks/usePinnedTables'
import type { ConnectionConfig, DistributedTable, ClusterNode, ColumnInfo } from '../types'

interface Props {
  tables: DistributedTable[]
  clusters: ClusterNode[]
  config: ConnectionConfig
}

// ── helpers ────────────────────────────────────────────────────────────────

function formatBytes(b: number | null) {
  if (b == null) return '—'
  if (b < 1024) return `${b} B`
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`
  return `${(b / 1024 ** 3).toFixed(2)} GB`
}

function formatRows(r: number | null) {
  if (r == null) return '—'
  if (r < 1_000) return String(r)
  if (r < 1_000_000) return `${(r / 1_000).toFixed(1)}K`
  if (r < 1_000_000_000) return `${(r / 1_000_000).toFixed(1)}M`
  return `${(r / 1_000_000_000).toFixed(2)}B`
}

interface DistributedConfig {
  cluster: string
  targetDb: string
  targetTable: string
  shardKey: string | null
}

function parseDistributedEngine(engineFull: string): DistributedConfig | null {
  const m = engineFull.match(/Distributed\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'(?:\s*,\s*(.+?))?\s*\)/)
  if (!m) return null
  return { cluster: m[1], targetDb: m[2], targetTable: m[3], shardKey: m[4]?.trim() ?? null }
}

function parseTTL(createQuery: string): string | null {
  const m = createQuery.match(/\bTTL\b\s+(.+?)(?=\s+SETTINGS\b|\s+ORDER BY\b|\s+PARTITION BY\b|\s+SAMPLE BY\b|$)/is)
  return m?.[1]?.trim() ?? null
}

// ── Column schema (lazy) ───────────────────────────────────────────────────

function SchemaSection({ config, database, table }: { config: ConnectionConfig; database: string; table: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['columns', database, table],
    queryFn: () => fetchTableColumns(config, database, table),
    staleTime: 60_000,
  })

  if (isLoading) return <div className="text-xs text-ch-muted py-2">Loading schema…</div>
  if (!data?.length) return <div className="text-xs text-ch-muted py-2">No columns found</div>

  return (
    <div className="overflow-x-auto rounded-lg border border-ch-border mt-2">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-ch-bg text-ch-muted uppercase tracking-wider">
            <th className="text-left px-3 py-2 font-medium">#</th>
            <th className="text-left px-3 py-2 font-medium">Column</th>
            <th className="text-left px-3 py-2 font-medium">Type</th>
            <th className="text-left px-3 py-2 font-medium">Default</th>
            <th className="text-left px-3 py-2 font-medium">Comment</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ch-border">
          {data.map((col: ColumnInfo) => (
            <tr key={col.name} className="hover:bg-ch-bg/40 transition-colors">
              <td className="px-3 py-1.5 text-ch-muted">{col.position}</td>
              <td className="px-3 py-1.5 font-medium text-ch-text font-mono">{col.name}</td>
              <td className="px-3 py-1.5 text-blue-400 font-mono">{col.type}</td>
              <td className="px-3 py-1.5 text-ch-muted font-mono">
                {col.default_kind ? `${col.default_kind} ${col.default_expression}` : '—'}
              </td>
              <td className="px-3 py-1.5 text-ch-muted italic">{col.comment || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Metadata pill ──────────────────────────────────────────────────────────

function MetaPill({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="flex-shrink-0 text-ch-muted mt-0.5">{icon}</span>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-ch-muted font-medium">{label}</div>
        <div className="text-xs text-ch-text font-mono break-all">{value}</div>
      </div>
    </div>
  )
}

// ── Distributed table card ─────────────────────────────────────────────────

interface CardProps {
  dist: DistributedTable
  replicatedTable: DistributedTable | null
  clusters: ClusterNode[]
  config: ConnectionConfig
  pinned: boolean
  onTogglePin: () => void
}

function DistributedCard({ dist, replicatedTable, clusters, config, pinned, onTogglePin }: CardProps) {
  const [open, setOpen] = useState(false)
  const [schemaOpen, setSchemaOpen] = useState(false)

  const distConfig = parseDistributedEngine(dist.engine_full)
  const target = replicatedTable ?? dist
  const ttl = parseTTL(target.create_table_query)

  // Use the replicated table's row/byte counts if available (Distributed shows null)
  const rows = dist.total_rows ?? replicatedTable?.total_rows ?? null
  const bytes = dist.total_bytes ?? replicatedTable?.total_bytes ?? null

  return (
    <div className={`bg-ch-surface border rounded-xl overflow-hidden transition-all ${pinned ? 'border-ch-accent/40 hover:border-ch-accent/60' : 'border-ch-border hover:border-ch-accent/20'}`}>
      {/* Header row — always visible */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-ch-bg/30 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        {open
          ? <ChevronDown className="w-4 h-4 text-ch-muted flex-shrink-0" />
          : <ChevronRight className="w-4 h-4 text-ch-muted flex-shrink-0" />
        }
        <Share2 className="w-4 h-4 text-blue-400 flex-shrink-0" />
        <span className="font-semibold text-ch-text text-sm">{dist.name}</span>

        {distConfig && (
          <span className="text-xs text-ch-muted hidden md:block">
            → {distConfig.targetDb}.{distConfig.targetTable}
          </span>
        )}

        <div className="ml-auto flex items-center gap-3 flex-shrink-0">
          {rows !== null && (
            <div className="text-right">
              <div className="text-[10px] text-ch-muted">Rows</div>
              <div className="text-xs font-mono text-ch-text">{formatRows(rows)}</div>
            </div>
          )}
          {bytes !== null && (
            <div className="text-right">
              <div className="text-[10px] text-ch-muted">Size</div>
              <div className="text-xs font-mono text-ch-text">{formatBytes(bytes)}</div>
            </div>
          )}
          <span className="text-[10px] bg-blue-500/15 text-blue-400 border border-blue-500/25 px-2 py-0.5 rounded font-medium">
            Distributed
          </span>
          <button
            onClick={e => { e.stopPropagation(); onTogglePin() }}
            title={pinned ? 'Unpin table' : 'Pin to top'}
            className={`p-1 rounded transition-colors ${pinned ? 'text-ch-accent hover:text-ch-accent/70' : 'text-ch-muted hover:text-ch-text'}`}
          >
            {pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
          </button>
        </div>
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="border-t border-ch-border px-4 py-4 space-y-5">
          {/* Two column layout: dist config + storage metadata */}
          <div className="grid md:grid-cols-2 gap-6">
            {/* Distributed config */}
            {distConfig && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-ch-muted font-semibold mb-2">
                  Distributed Config
                </div>
                <div className="divide-y divide-ch-border/50">
                  <MetaPill icon={<Layers className="w-3.5 h-3.5" />} label="Cluster" value={distConfig.cluster} />
                  <MetaPill
                    icon={<Database className="w-3.5 h-3.5" />}
                    label="Underlying Table"
                    value={`${distConfig.targetDb}.${distConfig.targetTable}`}
                  />
                  {distConfig.shardKey && (
                    <MetaPill icon={<Hash className="w-3.5 h-3.5" />} label="Shard Key" value={distConfig.shardKey} />
                  )}
                </div>
              </div>
            )}

            {/* Storage metadata from replicated table */}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ch-muted font-semibold mb-2">
                Storage Metadata
                {replicatedTable && (
                  <span className="ml-2 normal-case font-normal text-ch-muted">
                    (from {replicatedTable.engine})
                  </span>
                )}
              </div>
              <div className="divide-y divide-ch-border/50">
                {target.partition_key && (
                  <MetaPill icon={<Calendar className="w-3.5 h-3.5" />} label="Partition By" value={target.partition_key} />
                )}
                {target.sorting_key && (
                  <MetaPill icon={<ArrowUpDown className="w-3.5 h-3.5" />} label="Order By" value={target.sorting_key} />
                )}
                {target.primary_key && target.primary_key !== target.sorting_key && (
                  <MetaPill icon={<Tag className="w-3.5 h-3.5" />} label="Primary Key" value={target.primary_key} />
                )}
                {ttl && (
                  <MetaPill icon={<FileText className="w-3.5 h-3.5" />} label="TTL" value={ttl} />
                )}
                {target.storage_policy && (
                  <MetaPill icon={<HardDrive className="w-3.5 h-3.5" />} label="Storage Policy" value={target.storage_policy} />
                )}
                {!target.partition_key && !target.sorting_key && !ttl && (
                  <div className="text-xs text-ch-muted py-1.5">No metadata available</div>
                )}
              </div>
            </div>
          </div>

          {/* Shard → Hosts mapping */}
          {distConfig && (() => {
            const shardNodes = clusters.filter(c => c.cluster === distConfig.cluster)
            if (shardNodes.length === 0) return null
            const shards = new Map<number, ClusterNode[]>()
            for (const n of shardNodes) {
              const list = shards.get(n.shard_num) ?? []
              list.push(n)
              shards.set(n.shard_num, list)
            }
            return (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-ch-muted font-semibold mb-2">
                  Shard Topology ({shards.size} {shards.size === 1 ? 'shard' : 'shards'})
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {[...shards.entries()].sort((a, b) => a[0] - b[0]).map(([shardNum, replicas]) => (
                    <div key={shardNum} className="bg-ch-bg/60 border border-ch-border/50 rounded-lg px-3 py-2">
                      <div className="text-[10px] uppercase tracking-wider text-ch-muted font-medium mb-1.5">
                        Shard {shardNum}
                      </div>
                      <div className="space-y-1">
                        {replicas.sort((a, b) => a.replica_num - b.replica_num).map(r => (
                          <div key={`${r.host_name}:${r.port}`} className="flex items-center gap-1.5 text-xs">
                            <Server className="w-3 h-3 text-ch-muted flex-shrink-0" />
                            <span className="font-mono text-ch-text">{r.host_name}</span>
                            <span className="text-ch-muted">:{r.port}</span>
                            {r.is_local === 1 && (
                              <span className="text-[9px] bg-green-500/15 text-green-400 border border-green-500/25 px-1 rounded">local</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* Schema */}
          <div>
            <button
              className="flex items-center gap-1.5 text-xs font-semibold text-ch-muted hover:text-ch-text transition-colors"
              onClick={() => setSchemaOpen(o => !o)}
            >
              {schemaOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              Schema
              <span className="font-normal text-ch-muted/60">
                ({distConfig ? `${distConfig.targetDb}.${distConfig.targetTable}` : `${dist.database}.${dist.name}`})
              </span>
            </button>
            {schemaOpen && (
              <SchemaSection
                config={config}
                database={distConfig?.targetDb ?? dist.database}
                table={distConfig?.targetTable ?? dist.name}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Replicated-only card (no Distributed wrapper) ──────────────────────────

function ReplicatedCard({ table, config, pinned, onTogglePin }: { table: DistributedTable; config: ConnectionConfig; pinned: boolean; onTogglePin: () => void }) {
  const [open, setOpen] = useState(false)
  const [schemaOpen, setSchemaOpen] = useState(false)
  const ttl = parseTTL(table.create_table_query)

  return (
    <div className={`bg-ch-surface border rounded-xl overflow-hidden transition-all ${pinned ? 'border-ch-accent/40 hover:border-ch-accent/60' : 'border-ch-border hover:border-purple-500/20'}`}>
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-ch-bg/30 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        {open ? <ChevronDown className="w-4 h-4 text-ch-muted flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-ch-muted flex-shrink-0" />}
        <Database className="w-4 h-4 text-purple-400 flex-shrink-0" />
        <span className="font-semibold text-ch-text text-sm">{table.name}</span>
        <div className="ml-auto flex items-center gap-3 flex-shrink-0">
          {table.total_rows != null && (
            <div className="text-right">
              <div className="text-[10px] text-ch-muted">Rows</div>
              <div className="text-xs font-mono text-ch-text">{formatRows(table.total_rows)}</div>
            </div>
          )}
          {table.total_bytes != null && (
            <div className="text-right">
              <div className="text-[10px] text-ch-muted">Size</div>
              <div className="text-xs font-mono text-ch-text">{formatBytes(table.total_bytes)}</div>
            </div>
          )}
          <span className="text-[10px] bg-purple-500/15 text-purple-400 border border-purple-500/25 px-2 py-0.5 rounded font-medium">
            {table.engine.replace('Replicated', '').replace('MergeTree', 'MT')}
          </span>
          <button
            onClick={e => { e.stopPropagation(); onTogglePin() }}
            title={pinned ? 'Unpin table' : 'Pin to top'}
            className={`p-1 rounded transition-colors ${pinned ? 'text-ch-accent hover:text-ch-accent/70' : 'text-ch-muted hover:text-ch-text'}`}
          >
            {pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
          </button>
        </div>
      </button>

      {open && (
        <div className="border-t border-ch-border px-4 py-4 space-y-4">
          <div className="divide-y divide-ch-border/50">
            {table.partition_key && (
              <MetaPill icon={<Calendar className="w-3.5 h-3.5" />} label="Partition By" value={table.partition_key} />
            )}
            {table.sorting_key && (
              <MetaPill icon={<ArrowUpDown className="w-3.5 h-3.5" />} label="Order By" value={table.sorting_key} />
            )}
            {table.primary_key && table.primary_key !== table.sorting_key && (
              <MetaPill icon={<Tag className="w-3.5 h-3.5" />} label="Primary Key" value={table.primary_key} />
            )}
            {ttl && (
              <MetaPill icon={<FileText className="w-3.5 h-3.5" />} label="TTL" value={ttl} />
            )}
            {table.storage_policy && (
              <MetaPill icon={<HardDrive className="w-3.5 h-3.5" />} label="Storage Policy" value={table.storage_policy} />
            )}
          </div>
          <div>
            <button
              className="flex items-center gap-1.5 text-xs font-semibold text-ch-muted hover:text-ch-text transition-colors"
              onClick={() => setSchemaOpen(o => !o)}
            >
              {schemaOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              Schema
            </button>
            {schemaOpen && (
              <SchemaSection config={config} database={table.database} table={table.name} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Search bar ────────────────────────────────────────────────────────────

function SearchBar({ value, onChange, total }: { value: string; onChange: (v: string) => void; total: number }) {
  return (
    <div className="relative mb-4">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ch-muted pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={`Search ${total} tables…`}
        className="w-full bg-ch-surface border border-ch-border rounded-lg pl-9 pr-4 py-2 text-sm text-ch-text placeholder-ch-muted focus:outline-none focus:border-ch-accent/60 transition-colors"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-ch-muted hover:text-ch-text text-xs"
        >
          ✕
        </button>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export function DistributedTables({ tables, clusters, config }: Props) {
  const [search, setSearch] = useState('')
  const { isPinned, toggle } = usePinnedTables()

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return tables
    return tables.filter(t =>
      t.name.toLowerCase().includes(q) || t.database.toLowerCase().includes(q)
    )
  }, [tables, search])

  if (tables.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-ch-muted gap-2">
        <Database className="w-8 h-8 opacity-30" />
        <span className="text-sm">No Distributed or Replicated tables found</span>
      </div>
    )
  }

  const distTables = filtered.filter(t => t.engine === 'Distributed')
  const replicatedTables = filtered.filter(t => t.engine !== 'Distributed')

  // When search is active and nothing matches
  if (filtered.length === 0) {
    return (
      <div className="p-4 max-w-5xl mx-auto">
        <SearchBar value={search} onChange={setSearch} total={tables.length} />
        <div className="flex flex-col items-center justify-center h-48 text-ch-muted gap-2">
          <Search className="w-7 h-7 opacity-30" />
          <span className="text-sm">No tables match "<span className="text-ch-text">{search}</span>"</span>
        </div>
      </div>
    )
  }

  // Build a lookup: "db.table" → DistributedTable for replicated tables
  // Use ALL tables (not filtered) so linked lookups always work
  const allReplicated = tables.filter(t => t.engine !== 'Distributed')
  const replicatedMap = new Map(allReplicated.map(t => [`${t.database}.${t.name}`, t]))

  // Find which replicated tables are already linked from ANY distributed table
  const linkedKeys = new Set<string>()
  for (const dist of tables.filter(t => t.engine === 'Distributed')) {
    const cfg = parseDistributedEngine(dist.engine_full)
    if (cfg) linkedKeys.add(`${cfg.targetDb}.${cfg.targetTable}`)
  }

  const orphanedReplicated = filtered.filter(
    t => t.engine !== 'Distributed' && !linkedKeys.has(`${t.database}.${t.name}`)
  )

  // Pinned tables — apply search filter so search works within pinned section too
  const pinnedTables = filtered.filter(t => isPinned(`${t.database}.${t.name}`))

  // Group filtered non-pinned by database
  const visibleDist = distTables.filter(t => !isPinned(`${t.database}.${t.name}`))
  const visibleOrphans = orphanedReplicated.filter(t => !isPinned(`${t.database}.${t.name}`))
  const dbs = [...new Set([...visibleDist, ...visibleOrphans].map(t => t.database))].sort()

  const renderDistCard = (dist: DistributedTable) => {
    const cfg = parseDistributedEngine(dist.engine_full)
    const linked = cfg ? (replicatedMap.get(`${cfg.targetDb}.${cfg.targetTable}`) ?? null) : null
    const key = `${dist.database}.${dist.name}`
    return (
      <DistributedCard
        key={key} dist={dist} replicatedTable={linked} clusters={clusters} config={config}
        pinned={isPinned(key)} onTogglePin={() => toggle(key)}
      />
    )
  }

  const renderReplicatedCard = (t: DistributedTable) => {
    const key = `${t.database}.${t.name}`
    return (
      <ReplicatedCard
        key={key} table={t} config={config}
        pinned={isPinned(key)} onTogglePin={() => toggle(key)}
      />
    )
  }

  return (
    <div className="space-y-6 p-4 max-w-5xl mx-auto">
      <SearchBar value={search} onChange={setSearch} total={tables.length} />

      {/* Pinned section — always visible, unaffected by search */}
      {pinnedTables.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Pin className="w-3.5 h-3.5 text-ch-accent" />
            <span className="text-xs font-semibold uppercase tracking-wider text-ch-accent">
              Pinned ({pinnedTables.length})
            </span>
          </div>
          <div className="space-y-2">
            {pinnedTables.map(t =>
              t.engine === 'Distributed' ? renderDistCard(t) : renderReplicatedCard(t)
            )}
          </div>
          <div className="border-t border-ch-border mt-6" />
        </div>
      )}

      {/* No search results */}
      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center h-48 text-ch-muted gap-2">
          <Search className="w-7 h-7 opacity-30" />
          <span className="text-sm">No tables match "<span className="text-ch-text">{search}</span>"</span>
        </div>
      )}

      {/* Regular grouped view */}
      {dbs.map(db => {
        const dbDist = visibleDist.filter(t => t.database === db)
        const dbOrphans = visibleOrphans.filter(t => t.database === db)
        if (dbDist.length === 0 && dbOrphans.length === 0) return null

        return (
          <div key={db}>
            <div className="flex items-center gap-2 mb-3">
              <Database className="w-4 h-4 text-ch-accent" />
              <span className="font-semibold text-ch-text">{db}</span>
              <span className="text-xs text-ch-muted">
                {dbDist.length} distributed · {[...linkedKeys].filter(k => k.startsWith(`${db}.`)).length} replicated
              </span>
            </div>

            <div className="space-y-2">
              {dbDist.map(renderDistCard)}

              {dbOrphans.length > 0 && (
                <div className="mt-4">
                  <div className="text-[10px] uppercase tracking-wider text-ch-muted font-semibold mb-2 px-1">
                    Replicated (no Distributed wrapper)
                  </div>
                  <div className="space-y-2">
                    {dbOrphans.map(renderReplicatedCard)}
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
