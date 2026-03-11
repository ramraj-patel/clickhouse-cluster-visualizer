import { useState, useMemo } from 'react'
import {
  RefreshCw, Pause, Play, ChevronDown, ChevronRight,
  Info, AlertTriangle, CheckCircle, XCircle, X,
} from 'lucide-react'
import { useMetricsHistory, type MetricSource } from '../hooks/useMetricsHistory'
import { useShardMetrics } from '../hooks/useShardMetrics'
import { safeNum } from '../api/clickhouse'
import { fmtBytes, fmtDuration } from '../utils/format'
import type { ConnectionConfig, ReplicaInfo, DiskRow, ActiveTab, ClusterNode } from '../types'

// ── Props ───────────────────────────────────────────────────────────────────

interface Props {
  config: ConnectionConfig
  clusters: ClusterNode[]
  replicas: ReplicaInfo[]
  disks: DiskRow[]
  onNavigate: (tab: ActiveTab) => void
}

// ── Formatting helpers ──────────────────────────────────────────────────────

function fmtNum(n: number, decimals = 1): string {
  if (!isFinite(n)) return '—'
  if (n < 1000) return n % 1 === 0 ? String(n) : n.toFixed(decimals)
  if (n < 1_000_000) return `${(n / 1000).toFixed(decimals)}K`
  return `${(n / 1_000_000).toFixed(decimals)}M`
}

type FmtFormat = 'bytes' | 'bytes/s' | 'percent' | '/s' | 'rows/s' | 'seconds' | 'ms' | undefined

function fmtValue(n: number, fmt: FmtFormat): string {
  if (!isFinite(n)) return '—'
  if (fmt === 'bytes')   return fmtBytes(n)
  if (fmt === 'bytes/s') return `${fmtBytes(n)}/s`
  if (fmt === 'percent') return `${(n * 100).toFixed(1)}%`
  if (fmt === '/s')      return `${fmtNum(n)}/s`
  if (fmt === 'rows/s')  return `${fmtNum(n)} rows/s`
  if (fmt === 'seconds') return fmtDuration(n * 1000)
  if (fmt === 'ms')      return `${n.toFixed(0)} ms`
  return fmtNum(n, n < 10 ? 2 : 1)
}

// ── Metric definition types ─────────────────────────────────────────────────

interface MetricDef {
  key: string
  source: MetricSource
  label: string
  format?: FmtFormat
  warnAt?: number
  dangerAt?: number
  invertThreshold?: boolean  // danger when LOW (e.g. free space)
  description: string        // 1-line shown below value
  meaning: string            // what it measures technically
  impact: string             // operational/business impact
  whenToAct: string          // specific actionable guidance
  action?: string            // navigation button label
  actionTab?: ActiveTab
}

interface HealthSection {
  id: string
  label: string
  icon: string
  metrics: MetricDef[]
}

// ── Metric sections with rich metadata ─────────────────────────────────────

const SECTIONS: HealthSection[] = [
  {
    id: 'query-load', label: 'Query Load', icon: '⚡',
    metrics: [
      {
        key: 'Query', source: 'metrics', label: 'Active Queries',
        warnAt: 50, dangerAt: 200,
        description: 'Queries currently executing on this node.',
        meaning: 'Count of SQL queries in flight right now, tracked by system.metrics. Includes SELECT, INSERT, and other statement types across all connections.',
        impact: 'A sustained high count means the server is saturated — queries are queuing behind each other, increasing latency for all users. Above ~200 on a typical node, expect severe degradation.',
        whenToAct: 'Investigate if consistently > 50. Check system.processes for slow queries. Consider query concurrency limits (max_concurrent_queries). Above 200: treat as an incident.',
        action: 'View Processes', actionTab: 'processes',
      },
      {
        key: 'SelectQuery', source: 'events_rate', label: 'Select QPS', format: '/s',
        description: 'SELECT queries per second.',
        meaning: 'Rate derived from the cumulative system.events counter SelectQuery, sampled every 15 s. Reflects read query throughput from all clients.',
        impact: 'Baseline read load on the cluster. Sudden drops could indicate client connectivity issues; sustained spikes mean read load is growing.',
        whenToAct: 'Watch for unexpected drops (outage indicator) or step changes (traffic shift). No universal threshold — compare against your normal baseline.',
      },
      {
        key: 'InsertQuery', source: 'events_rate', label: 'Insert QPS', format: '/s',
        description: 'INSERT queries per second.',
        meaning: 'Rate from system.events InsertQuery counter. Each INSERT call counts as 1 regardless of row count.',
        impact: 'Write throughput at the query level. Very high rates (thousands/s) with small batches cause part explosion — merges fall behind, inserts get throttled.',
        whenToAct: 'If Insert QPS is high and Max Parts/Partition is growing, batch your writes larger (target 100–300 MB/insert). Use Buffer tables or asynchronous inserts.',
      },
      {
        key: 'FailedQuery', source: 'events_rate', label: 'Failed QPS', format: '/s',
        warnAt: 0.1, dangerAt: 1,
        description: 'Failed queries per second (all types).',
        meaning: 'Rate from FailedQuery events — every query that ends with an exception increments this. Includes timeouts, memory limit exceeded, table not found, etc.',
        impact: 'Any non-zero value means real users or pipelines are receiving errors. A rate > 1/s indicates a systemic problem rather than one-off failures.',
        whenToAct: 'Any sustained non-zero: check the Query Log for exception messages. Common causes: memory limits, missing tables after schema changes, ZK timeouts.',
        action: 'View Query Log', actionTab: 'query-log',
      },
      {
        key: 'FailedSelectQuery', source: 'events_rate', label: 'Failed Selects/s', format: '/s',
        warnAt: 0.1,
        description: 'Failed SELECT queries per second.',
        meaning: 'Subset of failed queries that were SELECTs. Isolates read failures from write failures.',
        impact: 'Read failures directly impact user-facing dashboards, reports, and APIs. Even a low rate may represent a high error fraction if QPS is also low.',
        whenToAct: 'Cross-reference with Active Queries and Query Log. Timeout errors suggest queries need optimisation or memory limits need raising.',
        action: 'View Query Log', actionTab: 'query-log',
      },
      {
        key: 'DelayedInserts', source: 'metrics', label: 'Throttled Inserts',
        warnAt: 1, dangerAt: 10,
        description: 'INSERTs being intentionally slowed by ClickHouse.',
        meaning: 'ClickHouse artificially delays INSERT responses when the number of active data parts in a partition exceeds the soft limit (150 by default). This is a self-protection mechanism to prevent part explosion.',
        impact: 'Clients experience write latency increases. Ingest pipelines slow down, potentially causing queue build-up upstream. Persistent throttling means merges are chronically behind.',
        whenToAct: 'Immediately check Max Parts/Partition. Root causes: too-frequent small inserts, insufficient merge threads, disk I/O saturation. Increase insert batch size or background merge pool size.',
        action: 'View Parts', actionTab: 'parts',
      },
      {
        key: 'SelectedRows', source: 'events_rate', label: 'Rows Read/s', format: 'rows/s',
        description: 'Rows scanned by SELECT queries per second.',
        meaning: 'Rate from SelectedRows events. Counts every row read during query execution, including rows filtered out by WHERE clauses before aggregation.',
        impact: 'High rows/s with low result rows indicates broad scans — the primary driver of CPU and I/O cost. Efficient primary key and partition filtering should keep this proportional to result size.',
        whenToAct: 'Correlate with CPU load. High value + low QPS = expensive queries. Investigate via Query Log: look for queries with high read_rows but small result_rows.',
        action: 'View Query Log', actionTab: 'query-log',
      },
      {
        key: 'MemoryTracking', source: 'metrics', label: 'Query Memory', format: 'bytes',
        warnAt: 10 * 1024 ** 3, dangerAt: 30 * 1024 ** 3,
        description: 'RAM currently allocated by executing queries.',
        meaning: 'Tracked by ClickHouse memory accounting (system.metrics MemoryTracking). Covers query buffers, hash tables for joins/aggregations, sort buffers, and result sets.',
        impact: 'When query memory approaches physical RAM, ClickHouse may trigger OOM kills on individual queries or, in extreme cases, crash the server process.',
        whenToAct: 'Above 10 GB: identify heavy queries via Query Log (memory_usage column). Above 30 GB on typical nodes: risk of OOM. Set max_memory_usage per query and max_server_memory_usage globally.',
      },
    ],
  },
  {
    id: 'ingestion', label: 'Ingestion & Merges', icon: '📥',
    metrics: [
      {
        key: 'InsertedRows', source: 'events_rate', label: 'Rows Inserted/s', format: 'rows/s',
        description: 'Rows written via INSERT per second.',
        meaning: 'Rate from InsertedRows events. The primary ingestion velocity metric — counts rows committed to storage across all tables and databases.',
        impact: 'Directly reflects your data ingest rate. Drops indicate upstream pipeline issues; unexpected spikes may indicate runaway batch replay or misconfigured producers.',
        whenToAct: 'Monitor for unexpected drops (data loss risk) or sustained spikes that cause Throttled Inserts or part accumulation.',
      },
      {
        key: 'InsertedBytes', source: 'events_rate', label: 'Bytes Inserted/s', format: 'bytes/s',
        description: 'Raw (uncompressed) bytes written per second.',
        meaning: 'Rate from InsertedBytes events. Uncompressed byte count — actual disk write is typically 3–10× smaller after compression.',
        impact: 'Network and disk I/O upstream of ClickHouse. At 1 GB/s uncompressed with 5× compression, disk writes ~200 MB/s — verify your disk throughput can sustain this alongside merges.',
        whenToAct: 'Compare against Disk Write/s. If disk writes approach disk capacity, consider tiered storage, larger disks, or reducing ingestion rate.',
      },
      {
        key: 'MaxPartCountForPartition', source: 'async', label: 'Max Parts/Partition',
        warnAt: 150, dangerAt: 300,
        description: 'Max data parts in any single partition.',
        meaning: 'Reports the worst partition across all tables on this node. ClickHouse stores each INSERT as a separate part; merges combine them. Too many parts → slower queries (more files to open) and throttled inserts.',
        impact: '150 parts triggers insert throttling (client sees increased write latency). 300 parts causes inserts to block entirely. Both states indicate merge throughput is inadequate for the insert rate.',
        whenToAct: 'Above 100: increase merge thread count (background_pool_size). Above 150: check if inserts are too small (< 1 MB). Above 300: emergency — pause ingestion and let merges catch up.',
        action: 'View Parts', actionTab: 'parts',
      },
      {
        key: 'Merge', source: 'metrics', label: 'Active Merges',
        warnAt: 10, dangerAt: 50,
        description: 'Background merge operations currently running.',
        meaning: 'Count from system.metrics Merge. ClickHouse runs background merges continuously to combine small parts into larger ones, improving query performance and reducing file count.',
        impact: 'Merges consume CPU, disk I/O, and memory. Very high counts indicate the merge queue is overwhelmed — either from high insert rate or insufficient merge threads.',
        whenToAct: 'Normal range is 0–5 per node. Above 10 with growing part counts: add merge capacity. Above 50: check for stuck merges via system.merges.',
        action: 'View Parts', actionTab: 'parts',
      },
      {
        key: 'MergedRows', source: 'events_rate', label: 'Merged Rows/s', format: 'rows/s',
        description: 'Rows being merged per second.',
        meaning: 'Rate from MergedRows events — rows read during merge operations. Healthy systems should merge faster than they ingest to keep part counts low.',
        impact: 'If Merged Rows/s < Rows Inserted/s over a sustained period, part counts will grow and eventually trigger throttling.',
        whenToAct: 'Compare against Rows Inserted/s. Merge rate should be ≥ 2–3× insert rate to maintain healthy part counts. Low merge rate: check merge pool utilisation.',
      },
      {
        key: 'MergedUncompressedBytes', source: 'events_rate', label: 'Merge Throughput', format: 'bytes/s',
        description: 'Uncompressed bytes merged per second.',
        meaning: 'Rate from MergedUncompressedBytes events. Reflects actual merge I/O throughput in terms of data volume processed.',
        impact: 'Indicates how much work the merge subsystem is doing. Very low despite high part counts suggests merge threads are blocked or throttled by I/O.',
        whenToAct: 'Correlate with Disk Write/s. If disk writes are saturated, merges compete with ingestion for I/O bandwidth — consider tiered storage or dedicated merge disks.',
      },
    ],
  },
  {
    id: 'hardware', label: 'Hardware & Threads', icon: '🔧',
    metrics: [
      {
        key: 'OSLoadAverage1', source: 'async', label: 'CPU Load (1m)',
        description: '1-minute OS load average.',
        meaning: 'Standard Unix load average from /proc/loadavg. Represents the average number of runnable + blocked-on-I/O processes over the last 60 seconds.',
        impact: 'A load average equal to the CPU core count means the system is fully utilised. Above core count: processes are waiting — CPU is the bottleneck. This directly translates to query latency.',
        whenToAct: 'Compare against your server\'s core count. Load > 2× cores: investigate heavy queries. Load > 4× cores: critical — restrict concurrent queries, scale out, or optimise.',
      },
      {
        key: 'OSLoadAverage5', source: 'async', label: 'CPU Load (5m)',
        description: '5-minute OS load average.',
        meaning: 'Smoother than 1-minute average, less affected by transient spikes. Best for assessing sustained CPU pressure.',
        impact: 'Persistent 5-minute load > core count indicates the system is consistently oversubscribed — queries are taking longer than they should across the board.',
        whenToAct: 'If 5m load stays above core count, reduce concurrent query limits or scale horizontally. Profile with Query Log to find the top CPU consumers.',
      },
      {
        key: 'OSLoadAverage15', source: 'async', label: 'CPU Load (15m)',
        description: '15-minute OS load average.',
        meaning: 'Long-trend CPU demand indicator. Useful for capacity planning — shows whether load is a transient spike or a structural pattern.',
        impact: 'High 15m load that doesn\'t track with known workloads suggests background work (merges, replication fetches) is consuming more than expected.',
        whenToAct: 'Use for capacity planning. Consistently high 15m load = time to add nodes or optimise the most expensive query patterns.',
      },
      {
        key: 'OSThreadsRunnable', source: 'async', label: 'Runnable Threads',
        warnAt: 50,
        description: 'Threads ready to run but waiting for a CPU core.',
        meaning: 'Count of OS threads in the runnable state. Runnable ≠ running — these threads are queued waiting for a CPU to become free.',
        impact: 'High runnable thread count is the clearest signal of CPU saturation. It directly causes latency for every operation: queries, merges, replication, ZK heartbeats.',
        whenToAct: 'Above 50 on a typical node: immediate CPU pressure. Reduce max_concurrent_queries, or add CPU capacity. Identify the top thread consumers via system.processes.',
      },
      {
        key: 'OSThreadsTotal', source: 'async', label: 'Total OS Threads',
        description: 'Total threads in the ClickHouse process.',
        meaning: 'All threads: query workers, background merges, replication tasks, HTTP handlers, ZK watchers, etc. Includes parked/sleeping threads.',
        impact: 'Unusually high thread counts (several thousand) may indicate a thread leak or runaway background task creation.',
        whenToAct: 'Should be roughly stable. Sudden growth: investigate recent configuration changes or runaway background tasks.',
      },
      {
        key: 'QueryThread', source: 'metrics', label: 'Query Threads',
        description: 'Active threads executing query processing.',
        meaning: 'Threads currently running query plan operators — table scans, aggregations, joins, etc. Each parallel sub-step of a query spawns threads up to max_threads.',
        impact: 'High query thread count with high CPU load confirms queries are the primary CPU consumer. Compare against OSThreadsTotal to understand query share of CPU.',
        whenToAct: 'Correlate with Active Queries. If query threads × max_threads_per_query > cores, reduce parallelism via max_threads setting.',
      },
      {
        key: 'MemoryResident', source: 'async', label: 'Physical RAM (RSS)', format: 'bytes',
        description: 'Physical RAM used by the ClickHouse process.',
        meaning: 'Resident Set Size from /proc/status. The actual physical memory mapped to the process — this is what the OS sees and is limited by your server\'s RAM.',
        impact: 'When RSS approaches total available RAM, the OS begins swapping — catastrophic for performance. ClickHouse may also hit max_server_memory_usage and reject queries.',
        whenToAct: 'RSS > 80% of available RAM: review caches (uncompressed cache, mark cache) for oversizing. Set max_server_memory_usage to a safe ceiling (e.g. 80% of RAM).',
      },
      {
        key: 'MemoryTracking', source: 'metrics', label: 'Query Memory Alloc', format: 'bytes',
        warnAt: 10 * 1024 ** 3, dangerAt: 30 * 1024 ** 3,
        description: 'Memory currently allocated by running queries.',
        meaning: 'Memory tracked by ClickHouse for live query execution — hash tables, sort buffers, read buffers. Does not include cache memory.',
        impact: 'Rapid spikes here correspond to heavy SELECT or INSERT operations. Persistent high values mean multiple expensive queries are running concurrently.',
        whenToAct: 'Use Query Log (memory_usage column) to identify the most memory-hungry queries. Set max_memory_usage (per query) and max_server_memory_usage (global).',
      },
      {
        key: 'BackgroundMergesAndMutationsPoolTask', source: 'metrics', label: 'Merge Pool Used',
        warnAt: 20,
        description: 'Background merge/mutation pool slots in use.',
        meaning: 'Current occupancy of the background_pool thread pool, which handles MergeTree merges and ALTER mutations. Pool size defaults to 16 threads.',
        impact: 'When the pool is fully occupied, new merges queue up — parts accumulate faster, eventually triggering insert throttling.',
        whenToAct: 'If consistently near pool max: increase background_pool_size in config. Check if mutations are consuming pool slots (system.mutations).',
        action: 'View Mutations', actionTab: 'mutations',
      },
      {
        key: 'BackgroundReplicationTask', source: 'metrics', label: 'Replication Pool Used',
        description: 'Background replication task pool slots in use.',
        meaning: 'Active threads processing replication log entries — fetching parts from other replicas, applying log entries. These are what keep replicas in sync.',
        impact: 'High sustained values indicate a replication backlog. If all slots are busy and the queue is growing, replicas fall further behind.',
        whenToAct: 'Check replication tab for queue depth. If queue is growing: may need to increase background_fetches_pool_size. Verify network bandwidth between replicas.',
        action: 'View Replication', actionTab: 'replication',
      },
      {
        key: 'NetworkSendBytes', source: 'events_rate', label: 'Network Out', format: 'bytes/s',
        description: 'Bytes sent over the network per second.',
        meaning: 'Rate from NetworkSendBytes events. Includes query results to clients and data sent to other shards/replicas.',
        impact: 'High outbound traffic on a replica = it is serving many requests as a data source (either query results or replication sends).',
        whenToAct: 'Near NIC capacity: consider load balancing or increasing network bandwidth. Unexpected spikes: check for large result set queries.',
      },
      {
        key: 'NetworkReceiveBytes', source: 'events_rate', label: 'Network In', format: 'bytes/s',
        description: 'Bytes received from the network per second.',
        meaning: 'Rate from NetworkReceiveBytes events. Includes incoming queries and data received during replication fetch from other replicas.',
        impact: 'Correlated with replication fetch activity and inbound INSERT traffic. Sustained high inbound can indicate a lagged replica catching up aggressively.',
        whenToAct: 'Near NIC capacity during catch-up: throttle replication_bandwidth_limit. During ingestion: ensure network is not the ingestion bottleneck.',
      },
      {
        key: 'OSReadBytes', source: 'async', label: 'Disk Read/s', format: 'bytes/s',
        description: 'Bytes read from disk per second (OS-level).',
        meaning: 'From /proc/diskstats — total disk read throughput for the ClickHouse process. Includes data file reads during SELECT queries and index file reads.',
        impact: 'High disk reads during queries indicate data is not cached (OS page cache or ClickHouse uncompressed cache). Disk I/O is frequently the bottleneck for analytics queries.',
        whenToAct: 'If disk reads are near device max throughput: consider increasing uncompressed_cache_size, optimising queries to scan fewer columns/rows, or using SSDs.',
      },
      {
        key: 'OSWriteBytes', source: 'async', label: 'Disk Write/s', format: 'bytes/s',
        description: 'Bytes written to disk per second (OS-level).',
        meaning: 'From /proc/diskstats. Driven by INSERT ingestion, background merges, and mutation rewrites. Write amplification from merges means disk writes > ingestion bytes.',
        impact: 'Disk I/O saturation affects both writes and reads (they share disk bandwidth). Heavy merge activity competes with ingestion and query reads.',
        whenToAct: 'Near disk write capacity: reduce merge aggressiveness or add storage. Compare with Merged Bytes/s to understand write amplification factor.',
      },
    ],
  },
  {
    id: 'replication-storage', label: 'Replication & Storage', icon: '🔄',
    metrics: [
      {
        key: 'ReplicasMaxAbsoluteDelay', source: 'async', label: 'Max Replica Lag', format: 'seconds',
        warnAt: 60, dangerAt: 300,
        description: 'Largest replication lag across all tables.',
        meaning: 'Maximum absolute_delay (seconds) from system.replicas, aggregated across all replicated tables on this node. 0 = fully in sync.',
        impact: 'A lagged replica may serve stale data to queries routed to it. Above 300s: the replica is dangerously behind and should be removed from the read pool until it catches up.',
        whenToAct: 'Above 60s: investigate replication queue for stuck tasks. Above 300s: mark replica as degraded in load balancer. Check disk I/O, ZK connectivity, and network bandwidth.',
        action: 'View Replication', actionTab: 'replication',
      },
      {
        key: 'ReplicasSumMergesInQueue', source: 'async', label: 'Merges Queued', format: undefined,
        warnAt: 100,
        description: 'Total pending merge tasks in replication queues.',
        meaning: 'Sum of merges_in_queue across all replicated tables. Each entry represents a merge that needs to be executed to match the replication log.',
        impact: 'Growing queue means this replica cannot process replication work fast enough. If unchecked, it leads to increasing lag and eventually replica falling out of sync.',
        whenToAct: 'Above 100 and growing: check system.replication_queue for individual table breakdown. May need to increase background_pool_size or diagnose stuck merge tasks.',
        action: 'View Replication', actionTab: 'replication',
      },
      {
        key: 'ReplicasSumInsertsInQueue', source: 'async', label: 'Inserts Queued', format: undefined,
        warnAt: 50,
        description: 'Total pending INSERT tasks in replication queues.',
        meaning: 'Sum of inserts_in_queue across all replicated tables. Each entry is a data part that needs to be fetched from another replica.',
        impact: 'High insert queue means this replica hasn\'t fetched recent data parts yet — queries on this replica will miss recent data.',
        whenToAct: 'Above 50 and growing: verify network connectivity to peer replicas. Check ReplicatedFetch count — are fetches actually happening? Could indicate bandwidth saturation.',
        action: 'View Replication', actionTab: 'replication',
      },
      {
        key: 'ReplicatedFetch', source: 'metrics', label: 'Parts Being Fetched',
        warnAt: 20,
        description: 'Data parts currently downloading from peers.',
        meaning: 'Count from system.metrics ReplicatedFetch. Active part fetch operations — this is the primary catch-up mechanism for lagged replicas.',
        impact: 'High sustained fetches = replica is significantly behind. Fetches consume network bandwidth and disk I/O, competing with query reads.',
        whenToAct: 'Normal during cluster recovery. Persistent high values: verify replica is not stuck (check system.replication_queue for failing tasks with retry counts).',
        action: 'View Replication', actionTab: 'replication',
      },
      {
        key: 'ReplicatedSend', source: 'metrics', label: 'Parts Being Sent',
        description: 'Data parts currently being sent to peer replicas.',
        meaning: 'Count from system.metrics ReplicatedSend. This node is acting as the data source for other replicas catching up.',
        impact: 'Normal activity. Very high values add network pressure and disk I/O, potentially impacting query performance on this node.',
        whenToAct: 'High sustained value with network saturation: throttle replication_bandwidth_limit. Check which replicas are catching up via system.replicas.',
      },
      {
        key: 'ZooKeeperSession', source: 'metrics', label: 'ZK Sessions',
        warnAt: 5,
        description: 'Active ZooKeeper/Keeper sessions.',
        meaning: 'Number of active ZooKeeper sessions held by this ClickHouse node. Under normal operation: 1. Multiple sessions may appear during reconnects.',
        impact: 'ZooKeeper loss = no DDL, no replication coordination, no distributed locks. A session count of 0 means replication is offline.',
        whenToAct: '0 sessions: immediate investigation — check ZK ensemble health. > 5 sessions: possible session leak from repeated reconnects; check ZK error logs.',
        action: 'View ZooKeeper', actionTab: 'zookeeper',
      },
      {
        key: 'ZooKeeperRequest', source: 'metrics', label: 'ZK In-flight Requests',
        description: 'ZooKeeper requests currently outstanding.',
        meaning: 'ZK requests in flight from this node. Spikes during heavy DDL, replication coordination, or distributed query planning.',
        impact: 'Very high outstanding requests may indicate ZK is under load or this node is generating excessive coordination traffic.',
        whenToAct: 'Sustained high values: check ZooKeeper ensemble CPU and latency. May need to reduce distributed_ddl concurrency or investigate replication storms.',
        action: 'View ZooKeeper', actionTab: 'zookeeper',
      },
    ],
  },
]

// ── Sparkline ───────────────────────────────────────────────────────────────

function Sparkline({
  data, warnAt, dangerAt, invertThreshold = false,
}: {
  data: number[]
  warnAt?: number
  dangerAt?: number
  invertThreshold?: boolean
}) {
  if (data.length < 2) {
    return <div className="h-10 flex items-center text-[10px] text-ch-muted/50">collecting…</div>
  }

  const W = 200, H = 40
  const max = Math.max(...data, 0.001)
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W
    const y = H - (v / max) * H * 0.9 - H * 0.05
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  const last = data[data.length - 1]
  let color = '#22c55e'
  if (invertThreshold) {
    color = dangerAt && last <= dangerAt ? '#ef4444'
          : warnAt  && last <= warnAt   ? '#f59e0b'
          : '#22c55e'
  } else {
    color = dangerAt && last >= dangerAt ? '#ef4444'
          : warnAt  && last >= warnAt   ? '#f59e0b'
          : '#22c55e'
  }

  const gradId = `sg${Math.abs((data.reduce((a, b) => a + b, 0) | 0) + data.length)}`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-10" preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon points={`0,${H} ${pts} ${W},${H}`} fill={`url(#${gradId})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

// ── MetricDetailDrawer ───────────────────────────────────────────────────────

interface DrawerProps {
  def: MetricDef
  value: number
  onClose: () => void
  onNavigate: (tab: ActiveTab) => void
}

function MetricDetailDrawer({ def, value, onClose, onNavigate }: DrawerProps) {
  const display = fmtValue(value, def.format)
  const isDanger = def.invertThreshold
    ? (def.dangerAt !== undefined && value <= def.dangerAt)
    : (def.dangerAt !== undefined && value >= def.dangerAt)
  const isWarn = !isDanger && (def.invertThreshold
    ? (def.warnAt !== undefined && value <= def.warnAt)
    : (def.warnAt !== undefined && value >= def.warnAt))

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 bg-ch-surface border-t border-ch-border shadow-2xl max-h-[55vh] overflow-y-auto">
      <div className="max-w-3xl mx-auto p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs uppercase tracking-wider text-ch-muted font-medium">{def.label}</span>
              {isDanger && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 font-semibold">DANGER</span>}
              {isWarn   && <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400 font-semibold">WARN</span>}
            </div>
            <div className={`text-3xl font-bold font-mono ${isDanger ? 'text-red-400' : isWarn ? 'text-yellow-400' : 'text-ch-text'}`}>
              {display}
            </div>
          </div>
          <button onClick={onClose} className="text-ch-muted hover:text-ch-text transition-colors flex-shrink-0 mt-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Metadata grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div className="bg-ch-bg rounded-lg p-3 border border-ch-border">
            <div className="text-[10px] uppercase tracking-wider text-ch-muted font-medium mb-1.5">What it measures</div>
            <p className="text-ch-text/90 text-xs leading-relaxed">{def.meaning}</p>
          </div>
          <div className="bg-ch-bg rounded-lg p-3 border border-ch-border">
            <div className="text-[10px] uppercase tracking-wider text-ch-muted font-medium mb-1.5">Operational impact</div>
            <p className="text-ch-text/90 text-xs leading-relaxed">{def.impact}</p>
          </div>
          <div className={`rounded-lg p-3 border ${isDanger ? 'bg-red-500/5 border-red-500/20' : isWarn ? 'bg-yellow-500/5 border-yellow-500/20' : 'bg-ch-bg border-ch-border'}`}>
            <div className="text-[10px] uppercase tracking-wider text-ch-muted font-medium mb-1.5">When to act</div>
            <p className="text-ch-text/90 text-xs leading-relaxed">{def.whenToAct}</p>
          </div>
        </div>

        {/* Thresholds */}
        {(def.warnAt !== undefined || def.dangerAt !== undefined) && (
          <div className="flex items-center gap-4 mt-3 text-xs text-ch-muted">
            <span>Thresholds:</span>
            {def.warnAt   !== undefined && <span className="text-yellow-400">⚠ warn ≥ {fmtValue(def.warnAt, def.format)}</span>}
            {def.dangerAt !== undefined && <span className="text-red-400">✕ danger ≥ {fmtValue(def.dangerAt, def.format)}</span>}
          </div>
        )}

        {/* Navigation action */}
        {def.action && def.actionTab && (
          <button
            onClick={() => { onNavigate(def.actionTab!); onClose() }}
            className="mt-4 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-ch-accent/10 border border-ch-accent/20 text-ch-accent text-xs font-medium hover:bg-ch-accent/20 transition-colors"
          >
            {def.action} →
          </button>
        )}
      </div>
    </div>
  )
}

// ── MetricCard ───────────────────────────────────────────────────────────────

function MetricCard({
  def, value, series, onInfo,
}: {
  def: MetricDef
  value: number
  series: number[]
  onInfo: () => void
}) {
  const display = fmtValue(value, def.format)
  const isDanger = def.invertThreshold
    ? (def.dangerAt !== undefined && value <= def.dangerAt)
    : (def.dangerAt !== undefined && value >= def.dangerAt)
  const isWarn = !isDanger && (def.invertThreshold
    ? (def.warnAt !== undefined && value <= def.warnAt)
    : (def.warnAt !== undefined && value >= def.warnAt))

  return (
    <div className={`bg-ch-surface border rounded-xl p-3 flex flex-col gap-1.5 transition-colors ${
      isDanger ? 'border-red-500/40' : isWarn ? 'border-yellow-500/30' : 'border-ch-border'
    }`}>
      <div className="flex items-start justify-between gap-1">
        <span className="text-[10px] uppercase tracking-wider text-ch-muted font-medium leading-tight">
          {def.label}
        </span>
        <div className="flex items-center gap-1 flex-shrink-0">
          {(isDanger || isWarn) && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${
              isDanger ? 'bg-red-500/15 text-red-400' : 'bg-yellow-500/15 text-yellow-400'
            }`}>
              {isDanger ? '!' : '~'}
            </span>
          )}
          <button
            onClick={onInfo}
            title="Learn more about this metric"
            className="text-ch-muted/40 hover:text-ch-accent transition-colors"
          >
            <Info className="w-3 h-3" />
          </button>
        </div>
      </div>

      <Sparkline data={series} warnAt={def.warnAt} dangerAt={def.dangerAt} invertThreshold={def.invertThreshold} />

      <div className={`text-lg font-bold font-mono leading-none ${
        isDanger ? 'text-red-400' : isWarn ? 'text-yellow-400' : 'text-ch-text'
      }`}>
        {display}
      </div>

      <p className="text-[10px] text-ch-muted leading-snug line-clamp-2">{def.description}</p>
    </div>
  )
}

// ── Status pill ──────────────────────────────────────────────────────────────

type HealthStatus = 'healthy' | 'warn' | 'danger' | 'unknown'

function StatusPill({
  label, status, onClick,
}: {
  label: string
  status: HealthStatus
  onClick?: () => void
}) {
  const colors: Record<HealthStatus, string> = {
    healthy: 'bg-green-500/10 border-green-500/20 text-green-400',
    warn:    'bg-yellow-500/10 border-yellow-500/20 text-yellow-400',
    danger:  'bg-red-500/10 border-red-500/20 text-red-400',
    unknown: 'bg-ch-border/30 border-ch-border text-ch-muted',
  }
  const icons: Record<HealthStatus, React.ReactNode> = {
    healthy: <CheckCircle className="w-3.5 h-3.5" />,
    warn:    <AlertTriangle className="w-3.5 h-3.5" />,
    danger:  <XCircle className="w-3.5 h-3.5" />,
    unknown: <RefreshCw className="w-3.5 h-3.5" />,
  }
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-opacity hover:opacity-80 ${colors[status]}`}
    >
      {icons[status]}
      {label}
    </button>
  )
}

// ── CollapsibleSection ───────────────────────────────────────────────────────

function CollapsibleSection({
  id, label, icon, defaultOpen = false, children,
}: {
  id: string
  label: string
  icon: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 py-2 text-left group"
      >
        <span className="text-base">{icon}</span>
        <h2 className="text-sm font-semibold text-ch-text flex-1">{label}</h2>
        {open
          ? <ChevronDown className="w-4 h-4 text-ch-muted group-hover:text-ch-text transition-colors" />
          : <ChevronRight className="w-4 h-4 text-ch-muted group-hover:text-ch-text transition-colors" />
        }
      </button>
      {open && <div className="mt-3">{children}</div>}
    </section>
  )
}

// ── AlertsPanel ──────────────────────────────────────────────────────────────

interface Alert {
  label: string
  message: string
  severity: 'warn' | 'danger'
  tab?: ActiveTab
  tabLabel?: string
}

function AlertsPanel({
  alerts, onNavigate,
}: {
  alerts: Alert[]
  onNavigate: (tab: ActiveTab) => void
}) {
  if (alerts.length === 0) return null
  return (
    <div className="space-y-1.5">
      {alerts.map((a, i) => (
        <div
          key={i}
          className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-xs ${
            a.severity === 'danger'
              ? 'bg-red-500/8 border-red-500/20 text-red-300'
              : 'bg-yellow-500/8 border-yellow-500/20 text-yellow-300'
          }`}
        >
          {a.severity === 'danger'
            ? <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            : <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          }
          <span className="flex-1">
            <span className="font-semibold">{a.label}</span>: {a.message}
          </span>
          {a.tab && (
            <button
              onClick={() => onNavigate(a.tab!)}
              className="flex-shrink-0 underline underline-offset-2 hover:no-underline"
            >
              {a.tabLabel ?? 'View →'}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Cluster health section (derived from props) ──────────────────────────────

function ClusterHealthSection({
  replicas, disks, clusters, config, paused, onNavigate,
}: {
  replicas: ReplicaInfo[]
  disks: DiskRow[]
  clusters: ClusterNode[]
  config: ConnectionConfig
  paused: boolean
  onNavigate: (tab: ActiveTab) => void
}) {
  const clusterNames = useMemo(
    () => [...new Set(clusters.map(c => c.cluster))].sort(),
    [clusters]
  )
  const [selectedCluster, setSelectedCluster] = useState<string | null>(null)

  // Default to first available cluster once list loads
  const effectiveCluster = useMemo(() => {
    if (selectedCluster) return selectedCluster
    return clusterNames.length > 0 ? clusterNames[0] : null
  }, [selectedCluster, clusterNames])

  const { data: shardRows = [], isFetching: shardFetching, error: shardError } = useShardMetrics(
    config, effectiveCluster, paused
  )

  const totalReplicas    = replicas.length
  const readonlyReplicas = replicas.filter(r => r.is_readonly === 1).length
  const zkExpiredReplicas = replicas.filter(r => r.is_session_expired === 1).length
  const maxLag           = Math.max(0, ...replicas.map(r => safeNum(r.absolute_delay)))
  const totalQueueDepth  = replicas.reduce((s, r) => s + safeNum(r.queue_size), 0)
  const unhealthyReplicas = readonlyReplicas + zkExpiredReplicas + replicas.filter(r => safeNum(r.absolute_delay) > 300).length

  const statCards = [
    { label: 'Total Replicas',   value: String(totalReplicas),    color: 'text-ch-text' },
    { label: 'Unhealthy',        value: String(unhealthyReplicas), color: unhealthyReplicas > 0 ? 'text-red-400' : 'text-green-400' },
    { label: 'Read-only',        value: String(readonlyReplicas),  color: readonlyReplicas > 0 ? 'text-red-400' : 'text-green-400' },
    { label: 'ZK Expired',       value: String(zkExpiredReplicas), color: zkExpiredReplicas > 0 ? 'text-red-400' : 'text-green-400' },
    { label: 'Max Lag',          value: maxLag > 0 ? fmtDuration(maxLag * 1000) : '0s', color: maxLag > 300 ? 'text-red-400' : maxLag > 60 ? 'text-yellow-400' : 'text-green-400' },
    { label: 'Queue Depth',      value: String(totalQueueDepth),   color: totalQueueDepth > 100 ? 'text-yellow-400' : 'text-ch-text' },
  ]

  return (
    <div className="space-y-5">
      {/* Replica stat cards */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {statCards.map(s => (
          <div key={s.label} className="bg-ch-surface border border-ch-border rounded-xl p-3">
            <div className="text-[10px] uppercase tracking-wider text-ch-muted font-medium mb-1">{s.label}</div>
            <div className={`text-xl font-bold font-mono ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Disk usage */}
      {disks.length > 0 && (
        <div>
          <div className="text-xs font-medium text-ch-muted uppercase tracking-wider mb-2">Disk Usage</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {disks.map(d => {
              const used = safeNum(d.used_fraction)
              const color = used > 0.95 ? 'bg-red-500' : used > 0.85 ? 'bg-yellow-500' : 'bg-green-500'
              const textColor = used > 0.95 ? 'text-red-400' : used > 0.85 ? 'text-yellow-400' : 'text-ch-muted'
              return (
                <div key={d.name} className="bg-ch-surface border border-ch-border rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-ch-text truncate">{d.name}</span>
                    <span className={`text-xs font-mono font-semibold ${textColor}`}>{(used * 100).toFixed(1)}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-ch-bg rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(used * 100, 100)}%` }} />
                  </div>
                  <div className="flex justify-between mt-1.5 text-[10px] text-ch-muted">
                    <span>{fmtBytes(safeNum(d.total_space) - safeNum(d.free_space))} used</span>
                    <span>{fmtBytes(safeNum(d.total_space))} total</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Per-shard traffic */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="text-xs font-medium text-ch-muted uppercase tracking-wider">Per-Shard Traffic</div>
          {clusterNames.length > 0 && (
            <select
              value={effectiveCluster ?? ''}
              onChange={e => setSelectedCluster(e.target.value || null)}
              className="appearance-none bg-ch-bg border border-ch-border rounded-lg px-2 py-1 text-xs text-ch-text focus:outline-none focus:border-ch-accent/60 transition-colors cursor-pointer"
            >
              {clusterNames.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {shardFetching && <RefreshCw className="w-3.5 h-3.5 text-ch-muted animate-spin" />}
        </div>

        {shardError ? (
          <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            Could not fetch shard metrics: {(shardError as Error).message}
          </div>
        ) : shardRows.length === 0 && !shardFetching ? (
          <div className="text-xs text-ch-muted py-2">
            {effectiveCluster ? 'No data — shard metrics require clusterAllReplicas() access.' : 'Select a cluster to view per-shard traffic.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-ch-border text-[10px] uppercase tracking-wider text-ch-muted">
                  <th className="text-left py-1.5 pr-4 font-medium">Shard</th>
                  <th className="text-left py-1.5 pr-4 font-medium">Host</th>
                  <th className="text-right py-1.5 pr-4 font-medium">Active Queries</th>
                  <th className="text-right py-1.5 pr-4 font-medium">Active Merges</th>
                  <th className="text-right py-1.5 pr-4 font-medium">Query Memory</th>
                  <th className="text-right py-1.5 pr-4 font-medium">Throttled</th>
                  <th className="text-right py-1.5 font-medium">TCP Conns</th>
                </tr>
              </thead>
              <tbody>
                {shardRows.map((row, i) => (
                  <tr key={i} className="border-b border-ch-border/50 hover:bg-ch-surface/50 transition-colors">
                    <td className="py-1.5 pr-4 font-mono text-ch-accent">{row._shard_num}</td>
                    <td className="py-1.5 pr-4 text-ch-muted truncate max-w-[180px]" title={row.host}>{row.host}</td>
                    <td className={`py-1.5 pr-4 text-right font-mono ${safeNum(row.active_queries) > 50 ? 'text-yellow-400' : 'text-ch-text'}`}>
                      {safeNum(row.active_queries)}
                    </td>
                    <td className={`py-1.5 pr-4 text-right font-mono ${safeNum(row.active_merges) > 10 ? 'text-yellow-400' : 'text-ch-text'}`}>
                      {safeNum(row.active_merges)}
                    </td>
                    <td className="py-1.5 pr-4 text-right font-mono text-ch-text">
                      {fmtBytes(safeNum(row.query_memory))}
                    </td>
                    <td className={`py-1.5 pr-4 text-right font-mono ${safeNum(row.delayed_inserts) > 0 ? 'text-red-400' : 'text-ch-text'}`}>
                      {safeNum(row.delayed_inserts)}
                    </td>
                    <td className="py-1.5 text-right font-mono text-ch-text">
                      {safeNum(row.tcp_conns)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center gap-2">
        <button onClick={() => onNavigate('topology')} className="text-xs text-ch-accent/80 hover:text-ch-accent underline underline-offset-2">
          View Topology →
        </button>
        <span className="text-ch-muted/40">·</span>
        <button onClick={() => onNavigate('replication')} className="text-xs text-ch-accent/80 hover:text-ch-accent underline underline-offset-2">
          View Replication →
        </button>
      </div>
    </div>
  )
}

// ── Main HealthDashboard ─────────────────────────────────────────────────────

export function HealthDashboard({ config, clusters, replicas, disks, onNavigate }: Props) {
  const [paused, setPaused] = useState(false)
  const [activeDrawer, setActiveDrawer] = useState<{ def: MetricDef; value: number } | null>(null)

  const { isFetching, getValue, getSeriesData, pollInterval, history } = useMetricsHistory(config, paused)

  const collecting = history.length < 2

  // ── Composite health status for status bar ────────────────────────────────

  const statusCluster = useMemo<HealthStatus>(() => {
    if (replicas.length === 0) return 'unknown'
    const readonly = replicas.some(r => r.is_readonly === 1)
    const zkExpired = replicas.some(r => r.is_session_expired === 1)
    if (readonly || zkExpired) return 'danger'
    const laggedBad = replicas.some(r => safeNum(r.absolute_delay) > 300)
    if (laggedBad) return 'danger'
    const laggedWarn = replicas.some(r => safeNum(r.absolute_delay) > 60)
    if (laggedWarn) return 'warn'
    return 'healthy'
  }, [replicas])

  const statusQuery = useMemo<HealthStatus>(() => {
    if (collecting) return 'unknown'
    const failedQps  = getValue('FailedQuery', 'events_rate')
    const activeQ    = getValue('Query', 'metrics')
    const throttled  = getValue('DelayedInserts', 'metrics')
    if (failedQps >= 1 || activeQ >= 200) return 'danger'
    if (failedQps >= 0.1 || activeQ >= 50 || throttled >= 10) return 'warn'
    return 'healthy'
  }, [collecting, getValue])

  const statusIngestion = useMemo<HealthStatus>(() => {
    if (collecting) return 'unknown'
    const throttled  = getValue('DelayedInserts', 'metrics')
    const maxParts   = getValue('MaxPartCountForPartition', 'async')
    if (throttled >= 10 || maxParts >= 300) return 'danger'
    if (throttled >= 1  || maxParts >= 150) return 'warn'
    return 'healthy'
  }, [collecting, getValue])

  const statusHardware = useMemo<HealthStatus>(() => {
    if (collecting) return 'unknown'
    const load1      = getValue('OSLoadAverage1', 'async')
    const runnable   = getValue('OSThreadsRunnable', 'async')
    const queryMem   = getValue('MemoryTracking', 'metrics')
    if (load1 >= 32 || runnable >= 100 || queryMem >= 30 * 1024 ** 3) return 'danger'
    if (load1 >= 16 || runnable >= 50  || queryMem >= 10 * 1024 ** 3) return 'warn'
    return 'healthy'
  }, [collecting, getValue])

  const statusReplication = useMemo<HealthStatus>(() => {
    if (collecting) return 'unknown'
    const maxLag     = getValue('ReplicasMaxAbsoluteDelay', 'async')
    const insQ       = getValue('ReplicasSumInsertsInQueue', 'async')
    if (maxLag >= 300) return 'danger'
    if (maxLag >= 60 || insQ >= 50) return 'warn'
    return 'healthy'
  }, [collecting, getValue])

  const statusStorage = useMemo<HealthStatus>(() => {
    if (disks.length === 0) return 'unknown'
    const maxUsed = Math.max(...disks.map(d => safeNum(d.used_fraction)))
    if (maxUsed >= 0.95) return 'danger'
    if (maxUsed >= 0.85) return 'warn'
    return 'healthy'
  }, [disks])

  // ── Alerts list ──────────────────────────────────────────────────────────

  const alerts = useMemo<Alert[]>(() => {
    const list: Alert[] = []

    // Cluster alerts
    const readonlyCount = replicas.filter(r => r.is_readonly === 1).length
    const zkExpiredCount = replicas.filter(r => r.is_session_expired === 1).length
    if (readonlyCount > 0) list.push({ label: 'Replica Read-only', message: `${readonlyCount} replica(s) are in read-only mode — writes are not being accepted`, severity: 'danger', tab: 'replication', tabLabel: 'Replication →' })
    if (zkExpiredCount > 0) list.push({ label: 'ZK Session Expired', message: `${zkExpiredCount} replica(s) have expired ZooKeeper sessions — replication coordination is offline`, severity: 'danger', tab: 'zookeeper', tabLabel: 'ZooKeeper →' })

    if (!collecting) {
      const failedQps = getValue('FailedQuery', 'events_rate')
      if (failedQps >= 1)   list.push({ label: 'High Error Rate', message: `${failedQps.toFixed(1)} failed queries/s — clients are receiving errors`, severity: 'danger', tab: 'query-log', tabLabel: 'Query Log →' })
      else if (failedQps >= 0.1) list.push({ label: 'Query Errors', message: `${failedQps.toFixed(2)} failed queries/s — some queries are failing`, severity: 'warn', tab: 'query-log', tabLabel: 'Query Log →' })

      const throttled = getValue('DelayedInserts', 'metrics')
      if (throttled >= 10)  list.push({ label: 'Insert Throttling', message: `${throttled} inserts throttled — merges are critically behind`, severity: 'danger', tab: 'parts', tabLabel: 'Parts →' })
      else if (throttled >= 1) list.push({ label: 'Insert Throttling', message: `${throttled} insert(s) being throttled — monitor part counts`, severity: 'warn', tab: 'parts', tabLabel: 'Parts →' })

      const maxParts = getValue('MaxPartCountForPartition', 'async')
      if (maxParts >= 300)  list.push({ label: 'Part Explosion', message: `Max parts/partition = ${maxParts} — inserts are blocked`, severity: 'danger', tab: 'parts', tabLabel: 'Parts →' })
      else if (maxParts >= 150) list.push({ label: 'High Part Count', message: `Max parts/partition = ${maxParts} — approaching throttle threshold`, severity: 'warn', tab: 'parts', tabLabel: 'Parts →' })

      const maxLag = getValue('ReplicasMaxAbsoluteDelay', 'async')
      if (maxLag >= 300)    list.push({ label: 'Replication Critical', message: `Max replica lag = ${Math.round(maxLag)}s — replicas are serving stale data`, severity: 'danger', tab: 'replication', tabLabel: 'Replication →' })
      else if (maxLag >= 60) list.push({ label: 'Replication Lag', message: `Max replica lag = ${Math.round(maxLag)}s`, severity: 'warn', tab: 'replication', tabLabel: 'Replication →' })
    }

    const criticalDisk = disks.find(d => safeNum(d.used_fraction) >= 0.95)
    const warnDisk     = disks.find(d => safeNum(d.used_fraction) >= 0.85)
    if (criticalDisk)  list.push({ label: 'Disk Critical', message: `${criticalDisk.name}: ${(safeNum(criticalDisk.used_fraction) * 100).toFixed(1)}% full — imminent data loss risk`, severity: 'danger', tab: 'parts', tabLabel: 'Parts →' })
    else if (warnDisk) list.push({ label: 'Disk Warning', message: `${warnDisk.name}: ${(safeNum(warnDisk.used_fraction) * 100).toFixed(1)}% full`, severity: 'warn', tab: 'parts', tabLabel: 'Parts →' })

    return list
  }, [replicas, disks, collecting, getValue])

  const statusBar = [
    { label: 'Cluster',     status: statusCluster,     section: 'cluster-health' },
    { label: 'Query Load',  status: statusQuery,        section: 'query-load' },
    { label: 'Ingestion',   status: statusIngestion,    section: 'ingestion' },
    { label: 'Hardware',    status: statusHardware,     section: 'hardware' },
    { label: 'Replication', status: statusReplication,  section: 'replication-storage' },
    { label: 'Storage',     status: statusStorage,      section: 'replication-storage' },
  ]

  return (
    <div className="p-4 space-y-5 max-w-[1400px] mx-auto pb-24">

      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ch-text">Health Dashboard</span>
          <span className="text-xs text-ch-muted">
            — polling every {pollInterval / 1000}s · {history.length} snapshots
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 text-ch-muted">
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin text-ch-accent' : ''}`} />
            {paused
              ? <span className="text-yellow-400">Paused</span>
              : collecting
              ? <span className="text-yellow-400">Collecting baseline…</span>
              : <span className="text-green-400">Live</span>
            }
          </div>
          <button
            onClick={() => setPaused(p => !p)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
              paused
                ? 'bg-green-500/10 border-green-500/30 text-green-400 hover:bg-green-500/20'
                : 'bg-ch-surface border-ch-border text-ch-muted hover:text-ch-text hover:border-ch-accent/30'
            }`}
          >
            {paused ? <><Play className="w-3.5 h-3.5" /> Resume</> : <><Pause className="w-3.5 h-3.5" /> Pause</>}
          </button>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex flex-wrap gap-2">
        {statusBar.map(s => (
          <StatusPill key={s.label} label={s.label} status={s.status} />
        ))}
      </div>

      {/* Alerts */}
      <AlertsPanel alerts={alerts} onNavigate={onNavigate} />

      {/* Cluster & Shard Health — expanded by default */}
      <CollapsibleSection id="cluster-health" label="Cluster & Shard Health" icon="🏛️" defaultOpen>
        <ClusterHealthSection
          replicas={replicas}
          disks={disks}
          clusters={clusters}
          config={config}
          paused={paused}
          onNavigate={onNavigate}
        />
      </CollapsibleSection>

      {/* Metric sections */}
      {SECTIONS.map(section => (
        <CollapsibleSection
          key={section.id}
          id={section.id}
          label={section.label}
          icon={section.icon}
          defaultOpen={false}
        >
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {section.metrics.map(def => (
              <MetricCard
                key={`${def.key}-${def.source}`}
                def={def}
                value={getValue(def.key, def.source)}
                series={getSeriesData(def.key, def.source)}
                onInfo={() => setActiveDrawer({ def, value: getValue(def.key, def.source) })}
              />
            ))}
          </div>
        </CollapsibleSection>
      ))}

      {/* Bottom drawer */}
      {activeDrawer && (
        <MetricDetailDrawer
          def={activeDrawer.def}
          value={activeDrawer.value}
          onClose={() => setActiveDrawer(null)}
          onNavigate={onNavigate}
        />
      )}
    </div>
  )
}
