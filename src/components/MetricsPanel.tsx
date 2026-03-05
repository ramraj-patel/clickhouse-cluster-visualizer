import { useState } from 'react'
import { RefreshCw, Pause, Play } from 'lucide-react'
import { useMetricsHistory, type MetricSource } from '../hooks/useMetricsHistory'
import type { ConnectionConfig } from '../types'

interface Props {
  config: ConnectionConfig
}

// ── SVG Sparkline ──────────────────────────────────────────────────────────

function Sparkline({
  data, warnAt, dangerAt,
}: {
  data: number[]
  warnAt?: number
  dangerAt?: number
}) {
  if (data.length < 2) {
    return (
      <div className="h-10 flex items-center text-[10px] text-ch-muted/50">
        collecting…
      </div>
    )
  }

  const W = 200, H = 40
  const max = Math.max(...data, 0.001)
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W
    const y = H - (v / max) * H * 0.9 - H * 0.05
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  const last = data[data.length - 1]
  const color = dangerAt && last >= dangerAt ? '#ef4444'
              : warnAt  && last >= warnAt   ? '#f59e0b'
              : '#22c55e'

  const gradId = `g${Math.abs(data.reduce((a, b) => a + b, 0) | 0)}`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-10" preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${H} ${pts} ${W},${H}`}
        fill={`url(#${gradId})`}
      />
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

// ── Value formatting ────────────────────────────────────────────────────────

function fmtBytes(n: number): string {
  if (!isFinite(n)) return '—'
  if (n < 1024) return `${n.toFixed(0)} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

function fmtNumber(n: number, decimals = 1): string {
  if (!isFinite(n)) return '—'
  if (n < 1000) return n % 1 === 0 ? String(n) : n.toFixed(decimals)
  if (n < 1_000_000) return `${(n / 1000).toFixed(decimals)}K`
  return `${(n / 1_000_000).toFixed(decimals)}M`
}

function fmtValue(n: number, fmt: MetricDef['format']): string {
  if (fmt === 'bytes')    return fmtBytes(n)
  if (fmt === 'bytes/s')  return `${fmtBytes(n)}/s`
  if (fmt === 'ms')       return `${n.toFixed(0)} ms`
  if (fmt === 'percent')  return `${(n * 100).toFixed(1)}%`
  if (fmt === '/s')       return `${fmtNumber(n)}/s`
  if (fmt === 'rows/s')   return `${fmtNumber(n)} rows/s`
  return fmtNumber(n, n < 10 ? 2 : 1)
}

// ── Metric definitions ──────────────────────────────────────────────────────

interface MetricDef {
  key: string
  source: MetricSource
  label: string
  description: string
  format?: 'bytes' | 'bytes/s' | 'ms' | 'percent' | '/s' | 'rows/s'
  warnAt?: number
  dangerAt?: number
}

interface MetricGroup {
  id: string
  label: string
  icon: string
  metrics: MetricDef[]
}

const GROUPS: MetricGroup[] = [
  {
    id: 'queries', label: 'Query Performance', icon: '⚡',
    metrics: [
      { key: 'Query',            source: 'metrics',      label: 'Active Queries',    format: undefined,  warnAt: 50, dangerAt: 200,
        description: 'Queries currently executing on this node. A sustained high count means the server is saturated — queries are queuing behind each other.' },
      { key: 'Query',            source: 'events_rate',  label: 'QPS (all)',          format: '/s',
        description: 'Total queries per second (SELECT + INSERT + other). Derived from the cumulative system.events counter divided by the polling interval.' },
      { key: 'SelectQuery',      source: 'events_rate',  label: 'Select QPS',         format: '/s',
        description: 'SELECT queries per second. The primary read workload metric.' },
      { key: 'InsertQuery',      source: 'events_rate',  label: 'Insert QPS',         format: '/s',
        description: 'INSERT queries per second. Reflects write throughput at the query level.' },
      { key: 'FailedQuery',      source: 'events_rate',  label: 'Failed QPS',         format: '/s', warnAt: 0.1, dangerAt: 1,
        description: 'Failed queries per second (all types). Any non-zero value means clients are receiving errors. Check logs for root cause.' },
      { key: 'FailedSelectQuery',source: 'events_rate',  label: 'Failed Selects/s',   format: '/s', warnAt: 0.1,
        description: 'Failed SELECT queries per second. Could indicate query timeouts, memory limits, or missing tables/columns.' },
      { key: 'DelayedInserts',   source: 'metrics',      label: 'Throttled Inserts',  warnAt: 1, dangerAt: 10,
        description: 'INSERTs being intentionally throttled by the server. ClickHouse slows down ingestion when there are too many small parts waiting to be merged. Persistent non-zero means merges can\'t keep up.' },
      { key: 'SelectedRows',     source: 'events_rate',  label: 'Rows Read/s',        format: 'rows/s',
        description: 'Rows read by SELECT queries per second. High values combined with low QPS indicate expensive wide scans.' },
      { key: 'InsertedRows',     source: 'events_rate',  label: 'Rows Inserted/s',    format: 'rows/s',
        description: 'Rows written via INSERT per second. The primary ingestion throughput metric.' },
    ],
  },
  {
    id: 'memory', label: 'Memory', icon: '🧠',
    metrics: [
      { key: 'MemoryTracking',   source: 'metrics', label: 'Query Memory',     format: 'bytes', warnAt: 10 * 1024 ** 3, dangerAt: 30 * 1024 ** 3,
        description: 'Memory currently allocated by running queries. This is the memory ClickHouse is actively tracking for query execution. Spikes here correspond to heavy SELECT or INSERT operations.' },
      { key: 'MemoryResident',   source: 'async',   label: 'RSS (Physical)',   format: 'bytes',
        description: 'Resident Set Size — physical RAM the OS has actually mapped to the ClickHouse process. This is what you see in `top`. Includes page cache-backed memory.' },
      { key: 'MemoryVirtual',    source: 'async',   label: 'Virtual Memory',   format: 'bytes',
        description: 'Total virtual address space claimed by the process. Usually much larger than RSS. Not a concern unless it approaches system limits.' },
      { key: 'UncompressedCacheBytes', source: 'async', label: 'Decompressed Cache', format: 'bytes',
        description: 'Size of the uncompressed block cache. ClickHouse decompresses data blocks and caches them here to avoid re-decompressing on repeated reads of the same data.' },
      { key: 'MarkCacheBytes',   source: 'async',   label: 'Mark Cache',       format: 'bytes',
        description: 'Size of the mark cache. Marks are index structures that tell ClickHouse which granules (groups of ~8192 rows) to read. Caching them avoids repeated disk seeks during range queries.' },
      { key: 'FilesystemCacheBytes', source: 'async', label: 'FS Cache',       format: 'bytes',
        description: 'Size of the filesystem-level cache (used with remote storage like S3). Caches data files locally to reduce remote reads.' },
    ],
  },
  {
    id: 'cpu', label: 'CPU & Threads', icon: '🔧',
    metrics: [
      { key: 'OSLoadAverage1',   source: 'async',   label: 'Load Avg 1m',
        description: '1-minute OS load average. For a healthy system this should be below the number of CPU cores. If it consistently exceeds core count, the system is CPU-saturated.' },
      { key: 'OSLoadAverage5',   source: 'async',   label: 'Load Avg 5m',
        description: '5-minute OS load average. A smoother view of CPU demand. More representative of sustained load than the 1-minute value.' },
      { key: 'OSLoadAverage15',  source: 'async',   label: 'Load Avg 15m',
        description: '15-minute OS load average. Shows long-term trends. If this is high even when the system seems idle, investigate background processes or recent query spikes.' },
      { key: 'OSThreadsTotal',   source: 'async',   label: 'OS Threads Total',
        description: 'Total number of OS threads in the ClickHouse process. Each query, background merge, replication task, and HTTP connection may spawn threads. Unusually high values can indicate thread leaks.' },
      { key: 'OSThreadsRunnable',source: 'async',   label: 'Threads Runnable',  warnAt: 50,
        description: 'Threads in a runnable state (ready to run but waiting for a CPU core). High values mean CPU is the bottleneck — more work is queued than the CPU can process.' },
      { key: 'QueryThread',      source: 'metrics', label: 'Query Threads',
        description: 'Active threads executing query processing. Each parallel sub-query or join step runs in a separate thread.' },
    ],
  },
  {
    id: 'merges', label: 'Merges & Parts', icon: '🗂️',
    metrics: [
      { key: 'Merge',             source: 'metrics', label: 'Active Merges',      warnAt: 10, dangerAt: 50,
        description: 'Background merge operations currently running. ClickHouse continuously merges small parts into larger ones for query efficiency. High sustained counts are normal but very high counts may indicate ingestion is outpacing merge capacity.' },
      { key: 'PartMutation',      source: 'metrics', label: 'Active Mutations',   warnAt: 1,
        description: 'ALTER UPDATE / ALTER DELETE mutations currently executing. Mutations rewrite data parts and are expensive. Multiple concurrent mutations can significantly impact query performance.' },
      { key: 'BackgroundMergesAndMutationsPoolTask', source: 'metrics', label: 'BG Merge Pool',  warnAt: 20,
        description: 'Background thread pool slots currently occupied by merge or mutation tasks. When this reaches the pool max (default 16–64), new merges queue up and parts accumulate.' },
      { key: 'MaxPartCountForPartition', source: 'async', label: 'Max Parts/Partition', warnAt: 150, dangerAt: 300,
        description: 'Maximum number of data parts in any single partition across all tables. ClickHouse starts throttling inserts at 150 parts and blocks them at 300. High values mean merges are falling behind. This is the most important early-warning metric for ingestion health.' },
      { key: 'MergedRows',        source: 'events_rate', label: 'Merged Rows/s',  format: 'rows/s',
        description: 'Rows being merged per second. Should generally be higher than insert rate to keep part counts low.' },
      { key: 'MergedUncompressedBytes', source: 'events_rate', label: 'Merged Bytes/s', format: 'bytes/s',
        description: 'Uncompressed bytes being merged per second — a measure of merge I/O throughput.' },
    ],
  },
  {
    id: 'replication', label: 'Replication', icon: '🔄',
    metrics: [
      { key: 'ReplicatedFetch',   source: 'metrics', label: 'Fetching Parts',    warnAt: 20,
        description: 'Data parts currently being downloaded from other replicas. This is the normal catch-up mechanism. High sustained values mean this replica is significantly behind.' },
      { key: 'ReplicatedSend',    source: 'metrics', label: 'Sending Parts',
        description: 'Data parts currently being sent to other replicas that are catching up. Normal activity, but high values add network and disk I/O pressure.' },
      { key: 'ReplicatedChecks',  source: 'metrics', label: 'Checking Parts',    warnAt: 5,
        description: 'Parts currently being verified for integrity (checksums, structure). Non-zero values after ingestion are normal, but persistent high values may indicate data corruption or incomplete downloads.' },
      { key: 'ReplicasMaxAbsoluteDelay', source: 'async', label: 'Max Replica Delay', warnAt: 60, dangerAt: 300,
        description: 'Largest replication lag (in seconds) across all replicated tables on this node. 0 = fully in sync. Values above 300s indicate a replica is significantly behind and may serve stale data.' },
      { key: 'ReplicasSumMergesInQueue', source: 'async', label: 'Total Merges Queued', warnAt: 100,
        description: 'Sum of pending merge tasks across all replicated tables\' replication queues. A growing value here means replicas are accumulating work they can\'t process fast enough.' },
      { key: 'ReplicasSumInsertsInQueue', source: 'async', label: 'Total Inserts Queued', warnAt: 50,
        description: 'Sum of pending INSERT replication tasks across all tables. Each queued insert means a data part hasn\'t been fetched yet by this replica.' },
    ],
  },
  {
    id: 'connections', label: 'Connections', icon: '🔌',
    metrics: [
      { key: 'TCPConnection',         source: 'metrics', label: 'TCP Connections',         warnAt: 500, dangerAt: 2000,
        description: 'Active TCP connections from clients (native ClickHouse protocol). Includes connections from clickhouse-client, drivers, and inter-server connections.' },
      { key: 'HTTPConnection',        source: 'metrics', label: 'HTTP Connections',        warnAt: 200,
        description: 'Active HTTP connections. Used by the HTTP interface, monitoring tools, and the proxy server in this visualizer.' },
      { key: 'InterserverConnection', source: 'metrics', label: 'Interserver Connections',
        description: 'Connections between ClickHouse nodes for replication and distributed query processing. High values during heavy replication are expected.' },
      { key: 'MySQLConnection',       source: 'metrics', label: 'MySQL Connections',
        description: 'Active connections via the MySQL compatibility protocol. Typically from BI tools like Grafana, Tableau, or Superset configured to connect via MySQL protocol.' },
      { key: 'ZooKeeperSession',      source: 'metrics', label: 'ZK Sessions',   warnAt: 5,
        description: 'Active ZooKeeper/Keeper sessions. Under normal operation this should be 1. Multiple sessions may appear during reconnects or if multiple subsystems open separate sessions.' },
      { key: 'ZooKeeperRequest',      source: 'metrics', label: 'ZK Requests In-flight',
        description: 'ZooKeeper/Keeper requests currently in flight. Spikes here during heavy replication or DDL operations are normal.' },
      { key: 'ZooKeeperWatch',        source: 'metrics', label: 'ZK Watches',
        description: 'Active ZooKeeper watches set by this node. Each replicated table and distributed coordination point registers watches. High counts are normal for clusters with many replicated tables.' },
    ],
  },
  {
    id: 'ingestion', label: 'Ingestion', icon: '📥',
    metrics: [
      { key: 'InsertedBytes',     source: 'events_rate', label: 'Bytes Inserted/s', format: 'bytes/s',
        description: 'Raw (uncompressed) bytes written via INSERT per second. Divide by your typical compression ratio (~3–10x) to estimate disk write throughput.' },
      { key: 'InsertedRows',      source: 'events_rate', label: 'Rows Inserted/s',  format: 'rows/s',
        description: 'Rows written per second across all tables. The primary ingestion velocity metric.' },
      { key: 'DistributedSend',   source: 'metrics',     label: 'Distributed Sends',
        description: 'Async INSERT batches currently being flushed from a Distributed table to remote shards. High values mean the distributed buffer is being heavily utilized.' },
      { key: 'StorageBufferBytes',source: 'metrics',     label: 'Buffer Table Bytes', format: 'bytes',
        description: 'Data currently held in Buffer engine tables, waiting to be flushed to the underlying target table. Normally this fluctuates with flush intervals.' },
    ],
  },
  {
    id: 'io', label: 'Disk I/O & File Descriptors', icon: '💾',
    metrics: [
      { key: 'OpenFileForRead',   source: 'metrics', label: 'Open Files (Read)',  warnAt: 5000,
        description: 'File descriptors currently open for reading. ClickHouse keeps data part files open during queries. High counts reflect concurrent read-heavy workloads.' },
      { key: 'OpenFileForWrite',  source: 'metrics', label: 'Open Files (Write)',
        description: 'File descriptors currently open for writing. Corresponds to active ingestion — each INSERT opens part files.' },
      { key: 'OSReadBytes',       source: 'async',   label: 'Disk Read/s',        format: 'bytes/s',
        description: 'Bytes read from disk per second (OS-level, from /proc). High sustained values during SELECT queries usually indicate the data isn\'t cached in OS page cache or ClickHouse\'s uncompressed cache.' },
      { key: 'OSWriteBytes',      source: 'async',   label: 'Disk Write/s',       format: 'bytes/s',
        description: 'Bytes written to disk per second (OS-level). Driven by INSERT ingestion and background merges. Compare with Merged Bytes/s to understand the write amplification from merging.' },
      { key: 'DiskReadElapsedMicroseconds', source: 'events_rate', label: 'Disk Read µs/s',  format: '/s',
        description: 'Cumulative disk read time (microseconds) per second. A proxy for disk read latency under load — high values indicate I/O saturation.' },
    ],
  },
  {
    id: 'network', label: 'Network', icon: '🌐',
    metrics: [
      { key: 'NetworkSendBytes',    source: 'events_rate', label: 'Network Out/s',  format: 'bytes/s',
        description: 'Bytes sent over the network per second. Includes query results sent to clients and data sent to other shards/replicas.' },
      { key: 'NetworkReceiveBytes', source: 'events_rate', label: 'Network In/s',   format: 'bytes/s',
        description: 'Bytes received from the network per second. Includes query requests from clients and data received during replication fetch.' },
      { key: 'NetworkSend',         source: 'metrics',     label: 'Active Net Sends',
        description: 'Network send operations currently in progress. Reflects concurrent outbound data transfers.' },
      { key: 'NetworkReceive',      source: 'metrics',     label: 'Active Net Recvs',
        description: 'Network receive operations currently in progress. Reflects concurrent inbound data transfers.' },
    ],
  },
  {
    id: 'locks', label: 'Locks & Contention', icon: '🔒',
    metrics: [
      { key: 'RWLockWaitingReaders', source: 'metrics', label: 'Lock Wait (Readers)', warnAt: 10,
        description: 'Threads waiting to acquire a read lock. Read locks are needed for SELECT queries. Waiting here means a writer is holding an exclusive lock — usually a DDL operation like ALTER or OPTIMIZE.' },
      { key: 'RWLockWaitingWriters', source: 'metrics', label: 'Lock Wait (Writers)', warnAt: 5, dangerAt: 20,
        description: 'Threads waiting to acquire a write lock. Write locks are needed for DDL operations. A queue of writers means multiple schema changes or OPTIMIZE operations are serialised.' },
      { key: 'RWLockActiveReaders',  source: 'metrics', label: 'Active Read Locks',
        description: 'Threads currently holding a read lock. Multiple readers can hold simultaneously — this is normal for concurrent SELECT workloads.' },
      { key: 'RWLockActiveWriters',  source: 'metrics', label: 'Active Write Locks', warnAt: 2,
        description: 'Threads currently holding a write lock (exclusive). Should normally be 0 or 1. Sustained > 1 is impossible (write locks are exclusive) — if you see it, it\'s a transient snapshot artifact.' },
      { key: 'ContextLock',          source: 'events_rate', label: 'Context Lock/s',  format: '/s',
        description: 'Rate of acquiring the global context lock per second. This lock protects the table registry and server context. High contention here can cause query slowdowns across the board.' },
    ],
  },
  {
    id: 'background', label: 'Background Work', icon: '⚙️',
    metrics: [
      { key: 'BackgroundReplicationTask',           source: 'metrics', label: 'Replication Tasks',
        description: 'Background threads processing replication queue items (fetching parts, applying log entries). These are the workers that keep replicas in sync.' },
      { key: 'BackgroundSchedulePoolTask',          source: 'metrics', label: 'Schedule Pool Tasks',
        description: 'Tasks in the background schedule pool — used for periodic distributed table flushes, TTL expiry checks, and other scheduled work.' },
      { key: 'BackgroundDistributedSendTask',       source: 'metrics', label: 'Distributed Flush Tasks',
        description: 'Background tasks flushing data from the distributed send buffer to remote shards. High values during heavy Distributed table INSERT workloads.' },
      { key: 'BackgroundMessageBrokerSchedulePoolTask', source: 'metrics', label: 'Kafka/NATS Tasks',
        description: 'Background tasks handling Kafka, RabbitMQ, or NATS message broker consumers. Each stream consumer runs as a background task.' },
    ],
  },
]

// ── Metric Card ─────────────────────────────────────────────────────────────

function MetricCard({
  def, value, series,
}: {
  def: MetricDef
  value: number
  series: number[]
}) {
  const display = fmtValue(value, def.format)
  const isDanger = def.dangerAt !== undefined && value >= def.dangerAt
  const isWarn   = !isDanger && def.warnAt !== undefined && value >= def.warnAt

  return (
    <div
      className={`bg-ch-surface border rounded-xl p-3 flex flex-col gap-1.5 transition-colors ${
        isDanger ? 'border-red-500/40' : isWarn ? 'border-yellow-500/30' : 'border-ch-border'
      }`}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="text-[10px] uppercase tracking-wider text-ch-muted font-medium leading-tight">
          {def.label}
        </span>
        {(isDanger || isWarn) && (
          <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold flex-shrink-0 ${
            isDanger ? 'bg-red-500/15 text-red-400' : 'bg-yellow-500/15 text-yellow-400'
          }`}>
            {isDanger ? '!' : '~'}
          </span>
        )}
      </div>

      <Sparkline data={series} warnAt={def.warnAt} dangerAt={def.dangerAt} />

      <div className={`text-lg font-bold font-mono leading-none ${
        isDanger ? 'text-red-400' : isWarn ? 'text-yellow-400' : 'text-ch-text'
      }`}>
        {display}
      </div>

      <p className="text-[10px] text-ch-muted leading-snug line-clamp-2" title={def.description}>
        {def.description}
      </p>
    </div>
  )
}

// ── Group section ───────────────────────────────────────────────────────────

function GroupSection({
  group, getValue, getSeriesData,
}: {
  group: MetricGroup
  getValue: (key: string, source: MetricSource) => number
  getSeriesData: (key: string, source: MetricSource) => number[]
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">{group.icon}</span>
        <h2 className="text-sm font-semibold text-ch-text">{group.label}</h2>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {group.metrics.map(def => (
          <MetricCard
            key={`${def.key}-${def.source}`}
            def={def}
            value={getValue(def.key, def.source)}
            series={getSeriesData(def.key, def.source)}
          />
        ))}
      </div>
    </section>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────

export function MetricsPanel({ config }: Props) {
  const [paused, setPaused] = useState(false)
  const { isFetching, getValue, getSeriesData, pollInterval, history } = useMetricsHistory(config, paused)

  const collecting = history.length < 2

  return (
    <div className="p-4 space-y-8 max-w-[1400px] mx-auto">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ch-text">Live Metrics</span>
          <span className="text-xs text-ch-muted">
            — polling every {pollInterval / 1000}s · {history.length} snapshots
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {/* Status indicator */}
          <div className="flex items-center gap-1.5 text-ch-muted">
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin text-ch-accent' : ''}`} />
            {paused
              ? <span className="text-yellow-400">Paused — showing last snapshot</span>
              : collecting
              ? <span className="text-yellow-400">Collecting baseline…</span>
              : <span className="text-green-400">Live</span>
            }
          </div>

          {/* Pause / Resume button */}
          <button
            onClick={() => setPaused(p => !p)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
              paused
                ? 'bg-green-500/10 border-green-500/30 text-green-400 hover:bg-green-500/20'
                : 'bg-ch-surface border-ch-border text-ch-muted hover:text-ch-text hover:border-ch-accent/30'
            }`}
          >
            {paused
              ? <><Play className="w-3.5 h-3.5" /> Resume</>
              : <><Pause className="w-3.5 h-3.5" /> Pause</>
            }
          </button>
        </div>
      </div>

      {/* Metric groups */}
      {GROUPS.map(group => (
        <GroupSection
          key={group.id}
          group={group}
          getValue={getValue}
          getSeriesData={getSeriesData}
        />
      ))}
    </div>
  )
}
