import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Server, ChevronDown, ChevronRight, HardDrive, Cpu, MemoryStick,
  FileText, Search, Pin, PinOff, Clock, Layers, Database,
} from 'lucide-react'
import { fetchHostInfo, fetchHostDisks, fetchHostTableCounts, fetchHostTables, fetchStoragePolicies } from '../api/clickhouse'
import { usePinnedTables } from '../hooks/usePinnedTables'
import type { ConnectionConfig, ClusterNode, HostInfoRow, HostDiskRow, StoragePolicyRow } from '../types'

interface Props {
  clusters: ClusterNode[]
  config: ConnectionConfig
}

// ── helpers ────────────────────────────────────────────────────────────────

function formatBytes(b: number) {
  if (b <= 0) return '—'
  if (b < 1024) return `${b} B`
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`
  if (b < 1024 ** 4) return `${(b / 1024 ** 3).toFixed(2)} GB`
  return `${(b / 1024 ** 4).toFixed(2)} TB`
}

function formatRows(r: number) {
  if (r <= 0) return '—'
  if (r < 1_000) return String(r)
  if (r < 1_000_000) return `${(r / 1_000).toFixed(1)}K`
  if (r < 1_000_000_000) return `${(r / 1_000_000).toFixed(1)}M`
  return `${(r / 1_000_000_000).toFixed(2)}B`
}

function formatUptime(seconds: number) {
  if (seconds <= 0) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`
}

function usageColor(fraction: number) {
  if (fraction > 0.95) return 'text-red-400'
  if (fraction > 0.85) return 'text-yellow-400'
  return 'text-green-400'
}

// ── Stat pill ──────────────────────────────────────────────────────────────

function StatPill({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="flex-shrink-0 text-ch-muted mt-0.5">{icon}</span>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-ch-muted font-medium">{label}</div>
        <div className="text-xs text-ch-text font-mono break-all">{value}</div>
        {sub && <div className="text-[10px] text-ch-muted">{sub}</div>}
      </div>
    </div>
  )
}

// ── Disk bar ───────────────────────────────────────────────────────────────

function DiskBar({ disk }: { disk: HostDiskRow }) {
  const used = Number(disk.used_fraction)
  return (
    <div className="bg-ch-bg/60 border border-ch-border/50 rounded-lg px-3 py-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-mono text-ch-text">{disk.disk_name}</span>
        <span className={`text-xs font-mono font-medium ${usageColor(used)}`}>{pct(used)}</span>
      </div>
      <div className="w-full h-1.5 bg-ch-border/50 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            used > 0.95 ? 'bg-red-500' : used > 0.85 ? 'bg-yellow-500' : 'bg-green-500'
          }`}
          style={{ width: `${Math.min(used * 100, 100)}%` }}
        />
      </div>
      <div className="flex justify-between mt-1 text-[10px] text-ch-muted">
        <span>{formatBytes(Number(disk.total_space) - Number(disk.free_space))} used</span>
        <span>{formatBytes(Number(disk.total_space))} total</span>
      </div>
      <div className="text-[10px] text-ch-muted mt-0.5 font-mono truncate" title={disk.disk_path}>
        {disk.disk_path}
      </div>
    </div>
  )
}

// ── Host card ──────────────────────────────────────────────────────────────

interface HostData {
  host: string
  shardNum: number
  replicaNum: number
  clusterName: string
  info: HostInfoRow | null
  disks: HostDiskRow[]
  tableCount: number
}

interface HostTableRow {
  host: string
  database: string
  name: string
  engine: string
  total_rows: number
  total_bytes: number
}

function HostTablesList({ config, clusterName, hostName }: { config: ConnectionConfig; clusterName: string; hostName: string }) {
  const [tableSearch, setTableSearch] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['host-tables-list', config, clusterName],
    queryFn: () => fetchHostTables(config, clusterName),
    staleTime: 60_000,
  })

  const allTables = useMemo(() => {
    if (!data) return []
    return data.filter((t: HostTableRow) => t.host === hostName)
  }, [data, hostName])

  const tables = useMemo(() => {
    const q = tableSearch.trim().toLowerCase()
    if (!q) return allTables
    return allTables.filter(t => t.name.toLowerCase().includes(q) || t.database.toLowerCase().includes(q))
  }, [allTables, tableSearch])

  if (isLoading) return <div className="text-xs text-ch-muted py-2">Loading tables…</div>
  if (allTables.length === 0) return <div className="text-xs text-ch-muted py-2">No user tables found</div>

  const byDb = new Map<string, HostTableRow[]>()
  for (const t of tables) {
    const list = byDb.get(t.database) ?? []
    list.push(t)
    byDb.set(t.database, list)
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ch-muted pointer-events-none" />
        <input
          type="text"
          value={tableSearch}
          onChange={e => setTableSearch(e.target.value)}
          placeholder={`Filter ${allTables.length} tables…`}
          className="w-full bg-ch-bg border border-ch-border/50 rounded-md pl-8 pr-3 py-1.5 text-xs text-ch-text placeholder-ch-muted focus:outline-none focus:border-ch-accent/60 transition-colors"
        />
        {tableSearch && (
          <button onClick={() => setTableSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ch-muted hover:text-ch-text text-[10px]">✕</button>
        )}
      </div>
      {tables.length === 0 && (
        <div className="text-xs text-ch-muted py-2">No tables match "{tableSearch}"</div>
      )}
      {[...byDb.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([db, dbTables]) => (
        <div key={db}>
          <div className="flex items-center gap-1.5 mb-1">
            <Database className="w-3 h-3 text-ch-accent" />
            <span className="text-[10px] uppercase tracking-wider text-ch-muted font-semibold">{db}</span>
            <span className="text-[10px] text-ch-muted">({dbTables.length})</span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-ch-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-ch-bg text-ch-muted uppercase tracking-wider">
                  <th className="text-left px-3 py-1.5 font-medium">Table</th>
                  <th className="text-left px-3 py-1.5 font-medium">Engine</th>
                  <th className="text-right px-3 py-1.5 font-medium">Rows</th>
                  <th className="text-right px-3 py-1.5 font-medium">Size</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ch-border">
                {dbTables.map(t => (
                  <tr key={`${t.database}.${t.name}`} className="hover:bg-ch-bg/40 transition-colors">
                    <td className="px-3 py-1.5 font-mono text-ch-text">{t.name}</td>
                    <td className="px-3 py-1.5 text-ch-muted">{t.engine}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-ch-text">{formatRows(Number(t.total_rows))}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-ch-text">{formatBytes(Number(t.total_bytes))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

function HostCard({ data, config, pinned, onTogglePin }: { data: HostData; config: ConnectionConfig; pinned: boolean; onTogglePin: () => void }) {
  const [open, setOpen] = useState(false)
  const [tablesOpen, setTablesOpen] = useState(false)

  const memUsed = data.info ? Number(data.info.os_memory_total) - Number(data.info.os_memory_available) : 0
  const memTotal = data.info ? Number(data.info.os_memory_total) : 0
  const memFraction = memTotal > 0 ? memUsed / memTotal : 0
  const fdOpen = data.info ? Number(data.info.open_file_descriptors) : 0
  const fdMax = data.info ? Number(data.info.max_file_descriptors) : 0
  const fdFraction = fdMax > 0 ? fdOpen / fdMax : 0

  return (
    <div className={`bg-ch-surface border rounded-xl overflow-hidden transition-all ${pinned ? 'border-ch-accent/40 hover:border-ch-accent/60' : 'border-ch-border hover:border-ch-accent/20'}`}>
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-ch-bg/30 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        {open ? <ChevronDown className="w-4 h-4 text-ch-muted flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-ch-muted flex-shrink-0" />}
        <Server className="w-4 h-4 text-blue-400 flex-shrink-0" />
        <span className="font-semibold text-ch-text text-sm font-mono">{data.host}</span>

        <div className="ml-auto flex items-center gap-3 flex-shrink-0">
          {data.info && (
            <>
              <div className="text-right hidden md:block">
                <div className="text-[10px] text-ch-muted">Memory</div>
                <div className={`text-xs font-mono ${usageColor(memFraction)}`}>{pct(memFraction)}</div>
              </div>
              <div className="text-right hidden md:block">
                <div className="text-[10px] text-ch-muted">CPUs</div>
                <div className="text-xs font-mono text-ch-text">{Number(data.info.cpu_cores)}</div>
              </div>
              <div className="text-right hidden md:block">
                <div className="text-[10px] text-ch-muted">Tables</div>
                <div className="text-xs font-mono text-ch-text">{data.tableCount}</div>
              </div>
            </>
          )}
          <span className="text-[10px] bg-blue-500/15 text-blue-400 border border-blue-500/25 px-2 py-0.5 rounded font-medium">
            S{data.shardNum} R{data.replicaNum}
          </span>
          <button
            onClick={e => { e.stopPropagation(); onTogglePin() }}
            title={pinned ? 'Unpin host' : 'Pin to top'}
            className={`p-1 rounded transition-colors ${pinned ? 'text-ch-accent hover:text-ch-accent/70' : 'text-ch-muted hover:text-ch-text'}`}
          >
            {pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
          </button>
        </div>
      </button>

      {open && (
        <div className="border-t border-ch-border px-4 py-4 space-y-5">
          <div className="grid md:grid-cols-2 gap-6">
            {/* System info */}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ch-muted font-semibold mb-2">
                System
              </div>
              <div className="divide-y divide-ch-border/50">
                <StatPill
                  icon={<Layers className="w-3.5 h-3.5" />}
                  label="Cluster / Shard / Replica"
                  value={`${data.clusterName} / Shard ${data.shardNum} / Replica ${data.replicaNum}`}
                />
                {data.info && (
                  <>
                    <StatPill
                      icon={<Clock className="w-3.5 h-3.5" />}
                      label="Uptime"
                      value={formatUptime(Number(data.info.uptime))}
                    />
                    <StatPill
                      icon={<Cpu className="w-3.5 h-3.5" />}
                      label="CPU Cores"
                      value={String(Number(data.info.cpu_cores))}
                      sub={`Load: ${Number(data.info.load_average_1m).toFixed(2)} (1m), ${Number(data.info.load_average_5m).toFixed(2)} (5m)`}
                    />
                    <StatPill
                      icon={<MemoryStick className="w-3.5 h-3.5" />}
                      label="Memory"
                      value={`${formatBytes(memUsed)} / ${formatBytes(memTotal)}`}
                      sub={`${pct(memFraction)} used, ${formatBytes(Number(data.info.os_memory_available))} available`}
                    />
                    <StatPill
                      icon={<FileText className="w-3.5 h-3.5" />}
                      label="Open Files"
                      value={fdOpen.toLocaleString()}
                      sub="Read + Write file handles"
                    />
                  </>
                )}
                <StatPill
                  icon={<HardDrive className="w-3.5 h-3.5" />}
                  label="Tables"
                  value={String(data.tableCount)}
                  sub="User tables (excl. system)"
                />
              </div>
            </div>

            {/* Disks */}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ch-muted font-semibold mb-2">
                Disks ({data.disks.length})
              </div>
              {data.disks.length === 0 ? (
                <div className="text-xs text-ch-muted py-1.5">No disk info available</div>
              ) : (
                <div className="space-y-2">
                  {data.disks.map(d => <DiskBar key={d.disk_name} disk={d} />)}
                </div>
              )}
            </div>
          </div>

          {/* Tables list — lazy loaded */}
          <div>
            <button
              className="flex items-center gap-1.5 text-xs font-semibold text-ch-muted hover:text-ch-text transition-colors"
              onClick={() => setTablesOpen(o => !o)}
            >
              {tablesOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              Tables ({data.tableCount})
            </button>
            {tablesOpen && (
              <div className="mt-2">
                <HostTablesList config={config} clusterName={data.clusterName} hostName={data.host} />
              </div>
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
        placeholder={`Search ${total} hosts…`}
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

// ── Storage Policies section ──────────────────────────────────────────────

function StoragePoliciesSection({ config }: { config: ConnectionConfig }) {
  const [open, setOpen] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ['storage-policies', config],
    queryFn: () => fetchStoragePolicies(config),
    staleTime: 60_000,
  })

  if (isLoading || !data?.length) return null

  const byPolicy = new Map<string, StoragePolicyRow[]>()
  for (const row of data) {
    const list = byPolicy.get(row.policy_name) ?? []
    list.push(row)
    byPolicy.set(row.policy_name, list)
  }

  return (
    <div className="bg-ch-surface border border-ch-border rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-ch-bg/30 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        {open ? <ChevronDown className="w-4 h-4 text-ch-muted" /> : <ChevronRight className="w-4 h-4 text-ch-muted" />}
        <HardDrive className="w-4 h-4 text-ch-accent" />
        <span className="font-semibold text-ch-text text-sm">Storage Policies</span>
        <span className="text-xs text-ch-muted">{byPolicy.size} {byPolicy.size === 1 ? 'policy' : 'policies'}</span>
      </button>
      {open && (
        <div className="border-t border-ch-border px-4 py-4 space-y-4">
          {[...byPolicy.entries()].map(([policyName, volumes]) => (
            <div key={policyName} className="bg-ch-bg/60 border border-ch-border/50 rounded-lg px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-semibold text-ch-text font-mono">{policyName}</span>
                <span className="text-[10px] bg-ch-accent/15 text-ch-accent border border-ch-accent/25 px-1.5 py-0.5 rounded">
                  {volumes.length} {volumes.length === 1 ? 'volume' : 'volumes'}
                </span>
              </div>
              <div className="space-y-2">
                {volumes.sort((a, b) => a.volume_priority - b.volume_priority).map(vol => (
                  <div key={vol.volume_name} className="text-xs">
                    <div className="flex items-center gap-2 mb-1">
                      <Layers className="w-3 h-3 text-ch-muted" />
                      <span className="font-mono text-ch-text">{vol.volume_name}</span>
                      <span className="text-[10px] text-ch-muted">priority {vol.volume_priority}</span>
                      <span className="text-[10px] text-ch-muted">• {vol.volume_type}</span>
                      <span className="text-[10px] text-ch-muted">• {vol.load_balancing}</span>
                    </div>
                    <div className="ml-5 flex flex-wrap gap-1.5">
                      {(vol.disks as string[]).map(disk => (
                        <span key={disk} className="text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-1.5 py-0.5 rounded font-mono">
                          {disk}
                        </span>
                      ))}
                    </div>
                    {vol.max_data_part_size > 0 && (
                      <div className="ml-5 mt-1 text-[10px] text-ch-muted">
                        Max part size: {formatBytes(Number(vol.max_data_part_size))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function HostsPanel({ clusters, config }: Props) {
  const [search, setSearch] = useState('')
  const { isPinned, toggle } = usePinnedTables('ch-pinned-hosts')

  const clusterNames = useMemo(() => [...new Set(clusters.map(c => c.cluster))], [clusters])
  const primaryCluster = clusterNames[0] ?? ''

  const { data: hostInfos } = useQuery({
    queryKey: ['host-info', config, primaryCluster],
    queryFn: () => fetchHostInfo(config, primaryCluster),
    enabled: !!primaryCluster,
    staleTime: 30_000,
    refetchInterval: 30_000,
  })

  const { data: hostDisks } = useQuery({
    queryKey: ['host-disks', config, primaryCluster],
    queryFn: () => fetchHostDisks(config, primaryCluster),
    enabled: !!primaryCluster,
    staleTime: 30_000,
    refetchInterval: 30_000,
  })

  const { data: hostTableCounts } = useQuery({
    queryKey: ['host-table-counts', config, primaryCluster],
    queryFn: () => fetchHostTableCounts(config, primaryCluster),
    enabled: !!primaryCluster,
    staleTime: 30_000,
    refetchInterval: 30_000,
  })

  const hosts: HostData[] = useMemo(() => {
    const uniqueHosts = new Map<string, ClusterNode>()
    for (const c of clusters) {
      if (!uniqueHosts.has(c.host_name)) uniqueHosts.set(c.host_name, c)
    }

    const infoMap = new Map<string, HostInfoRow>()
    for (const hi of hostInfos ?? []) infoMap.set(hi.host, hi)

    const diskMap = new Map<string, HostDiskRow[]>()
    for (const d of hostDisks ?? []) {
      const list = diskMap.get(d.host) ?? []
      list.push(d)
      diskMap.set(d.host, list)
    }

    const tableMap = new Map<string, number>()
    for (const t of hostTableCounts ?? []) tableMap.set(t.host, Number(t.table_count))

    return [...uniqueHosts.entries()].map(([hostName, node]) => ({
      host: hostName,
      shardNum: node.shard_num,
      replicaNum: node.replica_num,
      clusterName: node.cluster,
      info: infoMap.get(hostName) ?? null,
      disks: diskMap.get(hostName) ?? [],
      tableCount: tableMap.get(hostName) ?? 0,
    })).sort((a, b) => a.shardNum - b.shardNum || a.replicaNum - b.replicaNum)
  }, [clusters, hostInfos, hostDisks, hostTableCounts])

  if (clusters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-ch-muted gap-2">
        <Server className="w-8 h-8 opacity-30" />
        <span className="text-sm">No cluster hosts found</span>
      </div>
    )
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return hosts
    return hosts.filter(h => h.host.toLowerCase().includes(q))
  }, [hosts, search])

  const pinnedHosts = filtered.filter(h => isPinned(h.host))
  const unpinnedHosts = filtered.filter(h => !isPinned(h.host))

  // Group unpinned by shard
  const shardGroups = new Map<number, HostData[]>()
  for (const h of unpinnedHosts) {
    const list = shardGroups.get(h.shardNum) ?? []
    list.push(h)
    shardGroups.set(h.shardNum, list)
  }

  if (filtered.length === 0 && search) {
    return (
      <div className="p-4 max-w-5xl mx-auto">
        <SearchBar value={search} onChange={setSearch} total={hosts.length} />
        <div className="flex flex-col items-center justify-center h-48 text-ch-muted gap-2">
          <Search className="w-7 h-7 opacity-30" />
          <span className="text-sm">No hosts match "<span className="text-ch-text">{search}</span>"</span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-4 max-w-5xl mx-auto">
      <SearchBar value={search} onChange={setSearch} total={hosts.length} />

      <StoragePoliciesSection config={config} />

      {pinnedHosts.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Pin className="w-3.5 h-3.5 text-ch-accent" />
            <span className="text-xs font-semibold uppercase tracking-wider text-ch-accent">
              Pinned ({pinnedHosts.length})
            </span>
          </div>
          <div className="space-y-2">
            {pinnedHosts.map(h => (
              <HostCard key={h.host} data={h} config={config} pinned onTogglePin={() => toggle(h.host)} />
            ))}
          </div>
          <div className="border-t border-ch-border mt-6" />
        </div>
      )}

      {[...shardGroups.entries()].sort((a, b) => a[0] - b[0]).map(([shardNum, shardHosts]) => (
        <div key={shardNum}>
          <div className="flex items-center gap-2 mb-3">
            <Layers className="w-4 h-4 text-ch-accent" />
            <span className="font-semibold text-ch-text">Shard {shardNum}</span>
            <span className="text-xs text-ch-muted">{shardHosts.length} replica{shardHosts.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="space-y-2">
            {shardHosts.map(h => (
              <HostCard key={h.host} data={h} config={config} pinned={isPinned(h.host)} onTogglePin={() => toggle(h.host)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
