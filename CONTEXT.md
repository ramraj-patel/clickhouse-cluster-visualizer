# Cluster Visualizer — Project Context

> This file is the authoritative context document for AI models working on this codebase.
> Update it whenever architecture changes, new features are added, patterns shift, or key decisions are made.
> Do NOT let this file go stale — wrong context is worse than no context.

---

## What This Project Is

A real-time monitoring dashboard for ClickHouse clusters. Connects to any ClickHouse instance via HTTP API, proxied through a local Express server to handle CORS. All data is read-only — no writes to ClickHouse.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite 5, TypeScript 5, Tailwind CSS 3 |
| State / Data | TanStack Query v5 (`useQuery`, `useQueries`) |
| Graph Visualization | React Flow 11 |
| Markdown Rendering | ReactMarkdown + remark-gfm |
| Backend Proxy | Express 4 (`config/server.ts`) |
| HTTP Client | Axios |
| Dev Runner | `concurrently` (runs proxy + frontend simultaneously) |

---

## Port Layout

| Service | Port | Notes |
|---------|------|-------|
| Vite frontend | 5173 | `npm run client` |
| Express proxy | 3001 | `npm run server` |
| ClickHouse HTTP | 8123 (default) | User-configurable in ConnectionForm |

Dev proxy: Vite forwards `/api/*` → `http://localhost:3001` (configured in `vite.config.ts`).

---

## Directory Structure

```
cluster-visualizer/
├── index.html                    # Vite entry
├── vite.config.ts                # Dev proxy, plugin-react, PostCSS path
├── tsconfig.json                 # strict, ESNext, react-jsx
├── tsconfig.node.json
├── package.json                  # scripts: dev | client | server | build | preview
├── CONTEXT.md                    # ← this file
├── config/
│   ├── server.ts                 # Express proxy (POST /api/query, GET /api/ping)
│   ├── tailwind.config.js        # ch-* color tokens
│   └── postcss.config.js
├── docker/
│   ├── Dockerfile                # Two-stage build (node:20-alpine)
│   └── docker-compose.yml        # Exposes :3001
├── docs/
│   ├── README.md                 # Setup, tabs overview, troubleshooting
│   └── QUERIES.md                # SQL reference — keep in sync with clickhouse.ts
└── src/
    ├── main.tsx                  # ReactDOM.createRoot → App
    ├── App.tsx                   # Connection gate: ConnectionForm | Dashboard
    ├── index.css                 # Global styles
    ├── api/
    │   └── clickhouse.ts         # All typed query functions (source of truth for SQL)
    ├── types/
    │   ├── index.ts              # All interfaces + ActiveTab union type
    │   └── raw.d.ts              # Vite *.md?raw module declaration
    ├── utils/
    │   └── format.ts             # fmtBytes, fmtDuration, fmtElapsed, fmtAge, fmtRows, fmtMarks
    ├── hooks/
    │   ├── useClusterData.ts     # 7 parallel queries (incl. disks + serverErrors), 30s refetch
    │   ├── useMetricsHistory.ts  # 15s polling, 40 snapshots (~10 min history), rate derivation
    │   ├── useShardMetrics.ts    # 15s polling — clusterAllReplicas() per-shard live metrics
    │   ├── useProcesses.ts       # 5s refetch — live processes
    │   ├── useMutations.ts       # 30s refetch — mutation tracker
    │   ├── useQueryLog.ts        # On-demand (no auto-refresh) — investigative
    │   ├── usePartsData.ts       # usePartsSummary (60s) + useActiveMerges (15s)
    │   └── usePinnedTables.ts    # localStorage persistence (generic, keyed)
    └── components/
        ├── ConnectionForm.tsx
        ├── Dashboard.tsx         # 10 tabs, db filter, header stats + disk/error badges
        ├── ClusterTopology.tsx   # React Flow graph + NodeDrillDownPanel + RoutingPanel
        ├── DistributedTables.tsx
        ├── ReplicationStatus.tsx
        ├── ZookeeperNodes.tsx
        ├── HealthDashboard.tsx   # Health tab: status bar, alerts, cluster health, metric sections
        ├── MetricsPanel.tsx      # Legacy — no longer mounted; HealthDashboard replaced it
        ├── QueryLogViewer.tsx    # Query log, hotspots, direct query_id lookup, thread/shard drill-down
        ├── PartsInspector.tsx    # 3-level drill-down, active merges banner, part history
        ├── ProcessMonitor.tsx    # Live processes, 5s refresh, "View in Log" cross-link
        ├── MutationsTracker.tsx  # Mutation status, fail reason, parts_to_do countdown
        ├── QueryDocs.tsx         # Renders docs/QUERIES.md?raw
        └── HelpDrawer.tsx        # Record<ActiveTab, TabHelp> — all 10 tabs covered
```

---

## Data Flow

```
Browser
  └─ TanStack Query (useQuery hooks)
       └─ src/api/clickhouse.ts (typed async functions)
            └─ POST /api/query  { host, port, username, password, query }
                 └─ config/server.ts (Express proxy)
                      └─ HTTP GET http://{host}:{port}/?default_format=JSON
                           └─ ClickHouse
```

All API responses return `{ data: T[], rows: number, statistics: {...} }`.

---

## Express Proxy (config/server.ts)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/query` | POST | Proxy SQL to ClickHouse, return `{data, rows, statistics}` |
| `/api/ping` | GET | Health check, returns `{ok: true}` |
| `/*` | GET | SPA fallback — serves `dist/index.html` (production only, if dist/ exists) |

- Timeout: **30s** (increased from 15s to support 24h query_log windows and clusterAllReplicas())
- Auth: Basic HTTP auth if `username` supplied
- Error: Returns 5xx with ClickHouse error message

---

## API Functions (src/api/clickhouse.ts)

Every function signature: `fn(config: ConnectionConfig, ...args): Promise<T[]>`

| Function | Source Table | Returns | Notes |
|----------|-------------|---------|-------|
| `testConnection` | — | `string` (version) | Login gate |
| `fetchClusters` | `system.clusters` | `ClusterNode[]` | Topology |
| `fetchReplicas` | `system.replicas` | `ReplicaInfo[]` | Health, queue, delay |
| `fetchDistributedTables` | `system.tables` | `DistributedTable[]` | Engine filter: Distributed + Replicated* |
| `fetchTableColumns` | `system.columns` | `ColumnInfo[]` | Lazy per table |
| `fetchZookeeperConnections` | `system.zookeeper_connection` | `ZookeeperConnection[]` | ClickHouse 22.6+ only |
| `fetchZookeeperNodes` | `system.zookeeper` | `ZookeeperNode[]` | Lazy per path |
| `fetchReplicationQueue` | `system.replication_queue` | `ReplicationQueueItem[]` | LIMIT 200 |
| `fetchMetrics` | `system.metrics` | `MetricRow[]` | Gauges |
| `fetchEvents` | `system.events` | `EventRow[]` | Cumulative counters |
| `fetchAsyncMetrics` | `system.asynchronous_metrics` | `AsyncMetricRow[]` | OS-level samples |
| `fetchQueryLog` | `system.query_log` | `QueryLogRow[]` | is_initial_query=1, configurable window, server-side filters |
| `fetchQueryById` | `system.query_log` | `QueryLogRow[]` | Direct lookup by query_id, **no time restriction** — for "View in Log" |
| `fetchQueryLogFilterOptions` | `system.query_log` | `{databases, tables}` | Distinct values for filter dropdowns |
| `fetchQuerySubQueries` | `system.query_log` | `QueryLogRow[]` | Sub-queries by initial_query_id |
| `fetchQueryThreadDetail` | `system.query_thread_log` | `QueryThreadRow[]` | Per-thread CPU/memory; requires `log_query_threads=1` |
| `fetchTableHotspots` | `system.query_log` | `TableHotspotRow[]` | 1h window, GROUP BY arrayJoin(tables) |
| `fetchCrossShardBreakdown` | `clusterAllReplicas(system.query_log)` | `CrossShardRow[]` | Opt-in, slow, user-confirmed |
| `fetchShardMetrics` | `clusterAllReplicas(system.metrics)` | `ShardMetricRow[]` | Per-shard live: queries, merges, memory, throttled, TCP conns |
| `fetchPartsSummary` | `system.parts` | `PartSummaryRow[]` | GROUP BY database,table — always fetched |
| `fetchPartsForTable` | `system.parts` | `PartDetailRow[]` | Lazy per table, LIMIT 5000 |
| `fetchActiveMerges` | `system.merges` | `ActiveMergeRow[]` | Live snapshot, 15s |
| `fetchPartLog` | `system.part_log` | `PartLogRow[]` | Lazy per table, LIMIT 200 |
| `fetchProcesses` | `system.processes` | `ProcessRow[]` | Live snapshot, 5s |
| `fetchMutations` | `system.mutations` | `MutationRow[]` | LIMIT 200, 30s |
| `fetchDiskHealth` | `system.disks` | `DiskRow[]` | Header badge, 30s |
| `fetchServerErrors` | `system.errors` | `ServerErrorRow[]` | Header badge, WHERE value>0, 30s |
| `safeNum` | — | `number` | Coerces UInt64 strings safely (helper, not a fetch fn) |

---

## Hooks

### useClusterData(config)
- Runs 7 parallel `useQuery` calls: clusters, replicas, tables, replicationQueue, metrics, disks, serverErrors
- `refetchInterval: 30_000`, `staleTime: 10_000`
- Returns all arrays + `isLoading`, `error`, `refetchAll()`
- `disks` and `serverErrors` drive header badge signals (disk warning at >85%, danger >95%; error count)
- Used only in: `Dashboard.tsx`

### useMetricsHistory(config, paused)
- Polls fetchMetrics + fetchEvents + fetchAsyncMetrics every 15s
- Keeps last **40 snapshots** (~10 minutes of sparkline history) in local state
- Exposes: `getValue(key, source)`, `getSeriesData(key, source)`, `isFetching`, `pollInterval`, `history`
- `MetricSource` type: `'metrics' | 'events_rate' | 'async'`
- `events_rate` source: derives per-second rate by diffing two consecutive cumulative event counters
- Used by: `HealthDashboard.tsx`

### useShardMetrics(config, clusterName, paused)
- Polls `fetchShardMetrics(config, clusterName)` every 15s
- Disabled when `clusterName` is null
- `retry: 1` — graceful failure when `clusterAllReplicas()` access is unavailable
- Returns TanStack Query result: `data: ShardMetricRow[]`, `isFetching`, `error`
- Used by: `HealthDashboard.tsx` → `ClusterHealthSection`

### usePinnedTables(storageKey)
- Generic localStorage persistence for a Set<string>
- Three separate storage keys in use: `ch-pinned-tables`, `ch-pinned-replicas`, `ch-pinned-zk`

---

## Components

### Dashboard.tsx
Central shell. 10 tabs: `topology`, `tables`, `replication`, `zookeeper`, `health`, `query-log`, `parts`, `processes`, `mutations`, `docs`.
Owns: tab state, db filter dropdown, header stats, disk/error badge signals, `queryFilter` state.
`queryFilter` + `handleViewInLog(queryId)` implement the Process Monitor → Query Log cross-link.
Tab bar: `overflow-x-auto` to handle 10 tabs on narrow screens.
Health tab renders `<HealthDashboard config={config} clusters={clusters} replicas={replicas} disks={disks} onNavigate={setTab} />`.

### ClusterTopology.tsx
React Flow graph. Nodes: cluster (group) → shard (subgroup) → replica (leaf).
Health colors: green (healthy) / amber (readonly or delay > 300s) / red (errors_count > 5).
Layout: 2 clusters per row. Props include `tables` and `config` for drill-down and routing overlay.
`NodeDrillDownPanel` — right-side overlay showing host info and replicated tables for selected node.
`RoutingPanel` — left-side overlay with shard weight bars when a Distributed table is selected.
Routing overlay: animated gold dashed edges from cluster → shards proportional to shard_weight.

### DistributedTables.tsx
Two card types: `DistributedCard` (parses engine_full regex for cluster/db/table/shardKey) and `ReplicatedCard` (orphan replicated tables). Lazy schema loading via `fetchTableColumns`.

### ReplicationStatus.tsx
Per-table health cards. Queue type badges: GET_PART, MERGE_PARTS, DROP_RANGE, MUTATE_PART, ATTACH_PART, MOVE_PART. Health: healthy / degraded / down derived from replica fields.

### ZookeeperNodes.tsx
4 sections: ensemble connections, how-ZK-works diagram, table ZK registry (from replicas), lazy tree explorer (recursive TreeNode).

### HealthDashboard.tsx
**Replaces MetricsPanel as the Health tab.** Props: `config`, `clusters`, `replicas`, `disks`, `onNavigate`.

**Structure:**
- **Status bar** — 6 composite health pills: Cluster, Query Load, Ingestion, Hardware, Replication, Storage. Each is green/yellow/red derived from live metric values + props — no extra queries needed.
- **Alerts panel** — auto-shown when any threshold is breached. Each alert has a direct navigation link to the relevant tab.
- **Cluster & Shard Health section** (expanded by default):
  - 6 replica stat cards: total, unhealthy, read-only, ZK expired, max lag, queue depth (derived from `replicas` prop)
  - Disk usage bars per disk (from `disks` prop) with colour-coded fill and used/total labels
  - Per-shard traffic table using `useShardMetrics`; cluster selector defaults to first available cluster
- **4 collapsible metric sections** (collapsed by default): Query Load, Ingestion & Merges, Hardware & Threads, Replication & Storage
- **MetricCard** — shows label, sparkline, formatted value, threshold badge (! or ~). Has an `ⓘ` button.
- **MetricDetailDrawer** — bottom drawer triggered by `ⓘ`. Shows: current value with threshold state, 3-column grid (what it measures / operational impact / when to act), threshold labels, optional navigation button.

**MetricDef interface:**
```typescript
interface MetricDef {
  key: string
  source: MetricSource
  label: string
  format?: 'bytes' | 'bytes/s' | 'percent' | '/s' | 'rows/s' | 'seconds' | 'ms'
  warnAt?: number
  dangerAt?: number
  invertThreshold?: boolean  // danger when LOW (e.g. free space available)
  description: string        // 1-line shown below value in card
  meaning: string            // technical explanation (shown in drawer)
  impact: string             // operational/business impact (shown in drawer)
  whenToAct: string          // specific actionable guidance with threshold context
  action?: string            // navigation button label in drawer
  actionTab?: ActiveTab
}
```

**Status pill derivation logic:**
| Pill | Danger condition | Warn condition |
|------|-----------------|----------------|
| Cluster | any replica is_readonly=1 or is_session_expired=1 or absolute_delay>300 | any absolute_delay>60 |
| Query Load | FailedQuery/s ≥ 1 OR active queries ≥ 200 | FailedQuery/s ≥ 0.1 OR active queries ≥ 50 OR DelayedInserts ≥ 10 |
| Ingestion | DelayedInserts ≥ 10 OR MaxPartCountForPartition ≥ 300 | DelayedInserts ≥ 1 OR MaxPartCountForPartition ≥ 150 |
| Hardware | OSLoadAverage1 ≥ 32 OR runnable threads ≥ 100 OR query memory ≥ 30 GB | load ≥ 16 OR threads ≥ 50 OR memory ≥ 10 GB |
| Replication | ReplicasMaxAbsoluteDelay ≥ 300 | lag ≥ 60 OR ReplicasSumInsertsInQueue ≥ 50 |
| Storage | any disk used_fraction ≥ 0.95 | any disk used_fraction ≥ 0.85 |

### MetricsPanel.tsx
**Legacy — no longer mounted.** File kept for reference. All metrics were migrated to `HealthDashboard.tsx` with richer metadata. Can be deleted safely.

### QueryLogViewer.tsx
3 views: query list with inline expand, table hotspots. Histogram view was removed.

**"View in Log" integration (direct query_id lookup):**
- When `filterQueryId` prop is set (from Process Monitor), a dedicated `useQuery` runs `fetchQueryById` — **no time restriction**, polling every 5s until the query appears.
- `refetchInterval: (query) => query.state.data?.length ? false : 5_000` — stops polling once found.
- Shows a "still running" spinner state while the query is in flight in system.processes.
- Normal list `useQuery` runs independently in parallel.

**QueryDetailPanel tiers:**
- Tier 1: Sub-queries — auto-loaded via `fetchQuerySubQueries(initial_query_id)`
- Tier 2: Thread detail — click-to-load via `fetchQueryThreadDetail(query_id)`. Shows error banner when thread logging is disabled. `retry: 0` to surface errors immediately.
- Tier 3: Cross-shard breakdown — opt-in, cluster name selector, `fetchCrossShardBreakdown`

**Server-side filters:** database multiselect, table multiselect, query text ILIKE — all applied in SQL before results reach the browser. Exclude patterns: persistent NOT ILIKE exclusions per pattern, stored in localStorage.

**slowMs config was removed** — the slow query filter column was disabled; no UI for it.

### PartsInspector.tsx
Active merges banner at top (from `useActiveMerges`, 15s).
Health signals per table: avg_parts_per_partition, unmerged_parts, compression_ratio, max_refcount.
3-level drill-down: table row → partition sections → individual parts table.
`PartHistory` sub-component: lazy-loaded from `fetchPartLog` per table.

### ProcessMonitor.tsx
Props: `config, onViewInLog: (queryId: string) => void`.
5s auto-refresh via `useProcesses`. Self-filters any row where `query.includes('system.processes')`.
Progress bars: indeterminate when `total_rows_approx === 0`. Border: yellow at >60s, red at >300s.
"View in Log" button calls `onViewInLog(row.query_id)` → Dashboard sets `queryFilter` and switches to query-log tab.

### MutationsTracker.tsx
`isFailed(row)` checks `latest_fail_reason !== ''`. `cmdType(command)` regex extracts mutation type.
Show/hide completed toggle. `parts_to_do_names` expandable list for stuck mutation diagnosis.

### QueryDocs.tsx
Stateless. Imports `docs/QUERIES.md?raw` via Vite raw import, renders with ReactMarkdown + custom styled components.

### HelpDrawer.tsx
`HELP` typed as `Record<ActiveTab, TabHelp>` — TypeScript compile error if any tab is missing.
Covers all 10 tabs. Each entry has: icon, title, description, significance[], signals[], queries[].
The `health` key covers: status pill derivation, alert panel behaviour, per-shard traffic (clusterAllReplicas SQL), metric drawer usage, all three system table sources.
`SqlBlock` sub-component: collapsible SQL display.

---

## ActiveTab Values

```typescript
type ActiveTab =
  | 'topology' | 'tables' | 'replication' | 'zookeeper' | 'health'
  | 'query-log' | 'parts' | 'processes' | 'mutations'
  | 'docs'
```

Note: was `'metrics'` before the Health Dashboard redesign — renamed to `'health'`.

---

## Styling Conventions

Tailwind utility classes throughout. Custom color tokens defined in `config/tailwind.config.js`:

| Token | Hex | Usage |
|-------|-----|-------|
| `ch-bg` | `#0f1117` | Page background |
| `ch-surface` | `#1a1d27` | Cards, panels |
| `ch-border` | `#2a2d3e` | Dividers, outlines |
| `ch-accent` | `#ffcc00` | Gold highlights, active states |
| `ch-text` | `#e2e8f0` | Primary text |
| `ch-muted` | `#64748b` | Secondary text |

Dark theme only. No light mode.

---

## Polling Intervals

| Data | Interval | Stale Time | Hook / Location |
|------|----------|-----------|-----------------|
| Clusters, Replicas, Tables, Queue, Disks, Errors | 30s | 10s | `useClusterData` |
| Parts summary | 60s | 30s | `usePartsData` |
| Active merges | 15s | 10s | `usePartsData` |
| Metrics history (metrics, events, async) | 15s | 14s | `useMetricsHistory` |
| Per-shard live metrics | 15s | 14s | `useShardMetrics` |
| Live processes | 5s | 4s | `useProcesses` |
| Mutations | 30s | 15s | `useMutations` |
| Query log (list) | On-demand | — | `useQueryLog` |
| Query log (direct query_id lookup) | 5s until found, then stops | 10s | inside `QueryLogViewer` |
| ZK connections | 30s | 15s | inside `ZookeeperNodes` |
| ZK tree nodes | On-demand | 30s | inside `ZookeeperNodes` |
| Table columns | On-demand | 60s | inside `DistributedTables` |

---

## Key Invariants (Do Not Break)

1. **All SQL lives in `src/api/clickhouse.ts`** — no inline SQL in components or hooks.
2. **`docs/QUERIES.md` must stay in sync** with `clickhouse.ts` — update both together when adding/modifying queries.
3. **No writes to ClickHouse** — the app is strictly read-only. No kill, drop, alter, or admin actions.
4. **`config/server.ts` is the only backend file** — do not add a second server or split routes across files.
5. **New tabs** must be added to the `ActiveTab` union type in `src/types/index.ts`, wired in `Dashboard.tsx`, AND added to `HELP` in `HelpDrawer.tsx` (typed as `Record<ActiveTab, TabHelp>` — TypeScript enforces this).
6. **New components** follow the existing pattern: typed props interface at top, no direct API calls (pass data from Dashboard or use `useQuery` internally for lazy data only).
7. **localStorage keys** for pinned state must be namespaced (e.g. `ch-pinned-*`) and passed to `usePinnedTables`.
8. **UInt64 values from ClickHouse JSON** may arrive as strings — always use `safeNum(v)` from `clickhouse.ts` before arithmetic.
9. **ClickHouse DateTime strings** arrive as `"YYYY-MM-DD HH:MM:SS"` (no T, no Z) — parse with `new Date(str.replace(' ', 'T') + 'Z')`.
10. **`data_compressed_bytes` does NOT exist** in system.parts — use `bytes_on_disk` (compressed) and `data_uncompressed_bytes` (uncompressed).
11. **`is_initial_query = 1`** must be in all `system.query_log` list queries to exclude distributed sub-queries from the main list. Exception: `fetchQuerySubQueries` and `fetchQueryById` intentionally omit this filter.
12. **ProfileEvents aliases in ORDER BY** — do NOT use column aliases for ProfileEvents expressions in ORDER BY. Use the expression directly: `ORDER BY ProfileEvents['RealTimeMicroseconds'] DESC` (not `ORDER BY real_us DESC` — can fail in some ClickHouse versions).
13. **TanStack Query v5 `refetchInterval` function form** — when polling should stop once data arrives: `refetchInterval: (query) => query.state.data?.length ? false : 5_000`.

---

## ClickHouse Version Compatibility

| Feature | Min Version |
|---------|-------------|
| `system.zookeeper_connection` | 22.6 |
| `system.replicas` (full columns) | 21.x |
| `system.replication_queue` | 21.x |
| `system.asynchronous_metrics` | 20.x |
| `clusterAllReplicas()` | 20.6+ |
| `system.query_thread_log` | 21.x (requires `log_query_threads = 1`) |

The ZK connections fetch gracefully handles 404 (older versions) by returning empty array.
`fetchShardMetrics` uses `clusterAllReplicas()` — `retry: 1` handles clusters without cross-shard access.

---

## Known Gaps / Planned Features

| Feature | System Table(s) | Status |
|---------|----------------|--------|
| Query log viewer | `system.query_log` | **Built** — configurable window, server-side filters, hotspots, thread/shard drill-down, direct query_id lookup |
| Parts inspector | `system.parts`, `system.merges`, `system.part_log` | **Built** — 3-level drill-down, active merges, part history |
| Process monitor | `system.processes` | **Built** — 5s refresh, cross-link to Query Log |
| Mutations tracker | `system.mutations` | **Built** — countdown, fail reason, parts_to_do_names |
| Node drill-down panel | (existing cluster/replica data) | **Built** — right-side overlay in ClusterTopology |
| Cross-shard routing overlay | `system.clusters` shard_weight | **Built** — animated overlay, local size from system.parts |
| Disk health signals | `system.disks` | **Built** — header badge, warns at 85%, critical at 95% |
| Server error signals | `system.errors` | **Built** — header badge with error type count |
| Health Dashboard | `system.metrics`, `system.events`, `system.asynchronous_metrics`, `clusterAllReplicas(system.metrics)` | **Built** — status bar, alerts, cluster health, per-shard traffic, metric detail drawer |
| Alerting / threshold notifications | (existing thresholds) | Not started |
| Custom SQL console | ad-hoc queries | Not started |
| Export (JSON/CSV) | (existing data) | Not started |

---

## Build & Run

```bash
# Development (both servers)
npm run dev

# Frontend only
npm run client       # :5173

# Proxy only
npm run server       # :3001

# Production build
npm run build        # dist/ → served by Express in production

# Docker
docker compose -f docker/docker-compose.yml up --build
```

---

## Docker

Two-stage Dockerfile (`docker/Dockerfile`):
1. Builder: `node:20-alpine` — installs deps, builds frontend to `dist/`
2. Production: `node:20-alpine` — prod deps only + `tsx` for running `config/server.ts`

CMD: `node --import tsx/esm server.ts` (ESM-native TypeScript execution)
Exposed port: 3001

---

*Last updated: 2026-03-11 — Health Dashboard complete. All planned observability features built. Tabs: topology, tables, replication, zookeeper, health, query-log, parts, processes, mutations, docs.*
