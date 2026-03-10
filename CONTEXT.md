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
    │   ├── useMetricsHistory.ts  # 15s polling, 20 snapshots, rate derivation
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
        ├── MetricsPanel.tsx
        ├── QueryLogViewer.tsx    # Query log, cost scoring, hotspots, thread/shard drill-down
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
| `fetchQueryLog` | `system.query_log` | `QueryLogRow[]` | is_initial_query=1, 24h, LIMIT 200 |
| `fetchQuerySubQueries` | `system.query_log` | `QueryLogRow[]` | Sub-queries by initial_query_id |
| `fetchQueryThreadDetail` | `system.query_thread_log` | `QueryThreadRow[]` | Per-thread CPU/memory |
| `fetchTableHotspots` | `system.query_log` | `TableHotspotRow[]` | 24h GROUP BY arrayJoin(tables) |
| `fetchCrossShardBreakdown` | `clusterAllReplicas(system.query_log)` | `QueryLogRow[]` | Opt-in, slow, user-confirmed |
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
- Keeps last 20 snapshots in local state
- Exposes: `getValue`, `getHistory`, `getSeriesData`, `getRateHistory`
- Used only in: `MetricsPanel.tsx`

### usePinnedTables(storageKey)
- Generic localStorage persistence for a Set<string>
- Three separate storage keys in use: `ch-pinned-tables`, `ch-pinned-replicas`, `ch-pinned-zk`

---

## Components

### Dashboard.tsx
Central shell. 10 tabs: topology, tables, replication, zookeeper, metrics, query-log, parts, processes, mutations, docs.
Owns: tab state, db filter dropdown, header stats, disk/error badge signals, `queryFilter` state.
`queryFilter` + `handleViewInLog(queryId)` implement the Process Monitor → Query Log cross-link.
Tab bar: `overflow-x-auto` to handle 10 tabs on narrow screens.

### ClusterTopology.tsx
React Flow graph. Nodes: cluster (group) → shard (subgroup) → replica (leaf).
Health colors: green (healthy) / amber (readonly or delay > 300s) / red (errors_count > 5).
Layout: 2 clusters per row. Props now include `tables` and `config` for drill-down and routing overlay.
`NodeDrillDownPanel` — right-side overlay showing host info and replicated tables for selected node.
`RoutingPanel` — left-side overlay with shard weight bars when a Distributed table is selected.
Routing overlay: animated gold dashed edges from cluster → shards proportional to shard_weight.

### DistributedTables.tsx
Two card types: `DistributedCard` (parses engine_full regex for cluster/db/table/shardKey) and `ReplicatedCard` (orphan replicated tables). Lazy schema loading via `fetchTableColumns`.

### ReplicationStatus.tsx
Per-table health cards. Queue type badges: GET_PART, MERGE_PARTS, DROP_RANGE, MUTATE_PART, ATTACH_PART, MOVE_PART. Health: healthy / degraded / down derived from replica fields.

### ZookeeperNodes.tsx
4 sections: ensemble connections, how-ZK-works diagram, table ZK registry (from replicas), lazy tree explorer (recursive TreeNode).

### MetricsPanel.tsx
11 metric groups, 100+ metric definitions with warn/danger thresholds. Sparkline: 200×40 SVG. Source types: `metrics` | `events_rate` | `async`.

### QueryLogViewer.tsx
3 views: query list with inline expand, table hotspots, hourly histogram.
`QueryDetailPanel`: cost breakdown grid, Tier 1 sub-queries (auto), Tier 2 thread detail (click-to-load), Tier 3 cross-shard (cluster name input, opt-in).
Filter banner when `filterQueryId` prop set (from Process Monitor cross-link).
`CostBadge` component: 0–10 score, colored dot (green/amber/red).
`UserSummary`: collapsible, computed client-side.

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
`SqlBlock` sub-component: collapsible SQL display.

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

| Data | Interval | Stale Time | Hook |
|------|----------|-----------|------|
| Clusters, Replicas, Tables, Queue, Disks, Errors | 30s | 10s | `useClusterData` |
| Parts summary | 60s | 30s | `usePartsData` |
| Active merges | 15s | 10s | `usePartsData` |
| Metrics history (events, async) | 15s | 14s | `useMetricsHistory` |
| Live processes | 5s | 4s | `useProcesses` |
| Mutations | 30s | 15s | `useMutations` |
| Query log | On-demand | — | `useQueryLog` |
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
11. **`is_initial_query = 1`** must be in all `system.query_log` queries to exclude distributed sub-queries from the main list.

---

## ClickHouse Version Compatibility

| Feature | Min Version |
|---------|-------------|
| `system.zookeeper_connection` | 22.6 |
| `system.replicas` (full columns) | 21.x |
| `system.replication_queue` | 21.x |
| `system.asynchronous_metrics` | 20.x |

The ZK connections fetch gracefully handles 404 (older versions) by returning empty array.

---

## Known Gaps / Planned Features

| Feature | System Table(s) | Status |
|---------|----------------|--------|
| Query log viewer | `system.query_log` | **Built** — cost scoring, hotspots, thread/shard drill-down |
| Parts inspector | `system.parts`, `system.merges`, `system.part_log` | **Built** — 3-level drill-down, active merges, part history |
| Process monitor | `system.processes` | **Built** — 5s refresh, cross-link to Query Log |
| Mutations tracker | `system.mutations` | **Built** — countdown, fail reason, parts_to_do_names |
| Node drill-down panel | (existing cluster/replica data) | **Built** — right-side overlay in ClusterTopology |
| Cross-shard routing overlay | `system.clusters` shard_weight | **Built** — animated overlay, local size from system.parts |
| Disk health signals | `system.disks` | **Built** — header badge, warns at 85%, critical at 95% |
| Server error signals | `system.errors` | **Built** — header badge with error type count |
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

*Last updated: 2026-03-10 — Phase 7 complete. All 6 planned observability features built: Query Log Viewer, Parts Inspector, Process Monitor, Mutations Tracker, Node Drill-Down Panel, Cross-Shard Routing Overlay. Plus disk health + server error header signals. HelpDrawer covers all 10 tabs (Record<ActiveTab, TabHelp>). QUERIES.md extended to sections 10–15.*
