# ClickHouse Cluster Visualizer

A real-time dashboard for visualizing ClickHouse cluster topology, replication health, distributed tables, ZooKeeper state, and server metrics.

---

## How it works

The app has two parts:

| Part | Description | Port |
|------|-------------|------|
| **React frontend** | Vite dev server (or static build) | `5173` |
| **Express proxy** | Forwards SQL queries to ClickHouse to avoid browser CORS restrictions | `3001` |

Your browser talks to the Express proxy (`/api/query`), which in turn talks to your ClickHouse HTTP interface. Your ClickHouse credentials never leave your machine.

```
Browser → localhost:5173 → localhost:3001 (proxy) → ClickHouse :8123
```

---

## Option 1 — Run locally (development mode)

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| **Node.js** | 18 or higher | https://nodejs.org or `brew install node` |
| **npm** | comes with Node | — |
| **Git** | any | https://git-scm.com |

Check your versions:
```bash
node -v   # should be v18+
npm -v    # should be 9+
```

### Steps

**1. Clone the repository**
```bash
git clone <repo-url>
cd cluster-visualizer
```

**2. Install dependencies**
```bash
npm install
```

**3. Start the development servers**
```bash
npm run dev
```

This starts both servers concurrently:
- Frontend (Vite): http://localhost:5173
- Proxy server: http://localhost:3001

**4. Open the dashboard**

Navigate to http://localhost:5173 in your browser.

**5. Connect to your ClickHouse cluster**

Fill in the connection form:

| Field | Example | Notes |
|-------|---------|-------|
| Host | `my-clickhouse.example.com` | hostname or IP, no `http://` prefix |
| Port | `8123` | default ClickHouse HTTP port |
| Username | `default` | |
| Password | _(leave blank if none)_ | |

Click **Connect**. The dashboard loads once the connection test succeeds.

---

## Option 2 — Run with Docker

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| **Docker** | 20+ | https://docs.docker.com/get-docker/ |
| **Docker Compose** | v2 (included with Docker Desktop) | — |

Check your versions:
```bash
docker --version         # should be 20+
docker compose version   # should be v2+
```

### Steps

**1. Clone the repository**
```bash
git clone <repo-url>
cd cluster-visualizer
```

**2. Build and start the container**
```bash
docker compose up --build
```

**3. Open the dashboard**

Navigate to http://localhost:3001 in your browser.

> In Docker mode the Express server serves the pre-built static frontend **and** the proxy API — everything runs on a single port (`3001`).

**4. Stop the container**
```bash
docker compose down
```

### Rebuild after code changes
```bash
docker compose up --build
```

---

## Option 3 — Production build (no Docker)

Use this if you want to host the frontend on a static server and run the proxy separately.

**1. Build the frontend**
```bash
npm run build
```
Output goes to `dist/`.

**2. Start the proxy server**
```bash
node --loader tsx/esm server.ts
# or after compiling:
npx tsc && node dist-server/server.js
```

**3. Serve the static files**

Point any static file server at the `dist/` directory, or let the Express server serve them (Docker mode does this automatically).

---

## Project structure

```
cluster-visualizer/
├── server.ts               # Express proxy server (Node.js)
├── vite.config.ts          # Vite config — proxies /api to :3001 in dev
├── src/
│   ├── api/
│   │   └── clickhouse.ts   # All ClickHouse query functions
│   ├── components/
│   │   ├── Dashboard.tsx
│   │   ├── ClusterTopology.tsx
│   │   ├── DistributedTables.tsx
│   │   ├── ReplicationStatus.tsx
│   │   ├── ZookeeperNodes.tsx
│   │   ├── MetricsPanel.tsx
│   │   ├── HelpDrawer.tsx
│   │   └── QueryDocs.tsx
│   ├── hooks/
│   │   ├── useClusterData.ts
│   │   ├── useMetricsHistory.ts
│   │   └── usePinnedTables.ts
│   └── types/
│       └── index.ts
├── QUERIES.md              # Documentation for all SQL queries used
├── Dockerfile
└── docker-compose.yml
```

---

## Tabs overview

### Topology
Interactive graph: **Cluster → Shard → Replica**. Built from `system.clusters` and `system.replicas`.

**Cluster header**
- Gold label for user clusters, grey for system clusters (`test_*`, `all_groups`, `*_localhost`)
- `SYSTEM` badge on built-in ClickHouse clusters
- `N ⚠` badge showing count of unhealthy replicas
- Animated edges to shards when replication is active
- 📋 Copy button — exports cluster summary as JSON

**Shard box**
- Border colour = worst replica health in that shard (green / amber / red)
- `N/M active` — active vs total replica count
- `· w:N` — shard weight when non-default
- `● replicating` dot when any replica has queued work

**Replica node**
- Health dot (green/amber/red) derived from errors, readonly state, and replication lag
- 👑 Crown on the current replication leader
- `LOCAL` badge on the node being queried
- Replication lag in seconds (yellow >60s, red >300s) — hidden when 0
- Queue depth (pending replication tasks) — hidden when 0
- `READONLY` badge when `is_readonly = 1`
- `ZK EXPIRED` badge when ZooKeeper session has expired

**Controls**
- Cluster multi-select dropdown with search — show only the clusters you care about
- Lock toggle — when locked, scroll pans the canvas instead of zooming
- Zoom defaults to fit 2 rows on screen at startup and on window resize
- Legend (healthy / degraded / down / leader / system) in the toolbar

**Copy cluster JSON**

Click 📋 on a cluster header to copy the full cluster detail as JSON — includes nested shards and all replica metadata:

```json
{
  "cluster": "my_cluster",
  "type": "user",
  "shard_count": 2,
  "total_replicas": 4,
  "unhealthy_replicas": 1,
  "has_active_replication": true,
  "shards": [
    {
      "shard": 1,
      "shard_weight": 1,
      "health": "degraded",
      "active_replicas": 2,
      "total_replicas": 2,
      "has_active_replication": true,
      "replicas": [
        {
          "host": "ch-node-1.internal",
          "address": "10.0.0.1:9000",
          "replica_num": 1,
          "is_local": true,
          "health": "healthy",
          "is_leader": true,
          "is_readonly": false,
          "zk_session_expired": false,
          "replication_lag_s": 0,
          "queue_depth": 0,
          "errors_count": 0
        }
      ]
    }
  ]
}
```

---

### Tables
`system.tables` filtered to `Distributed` and `Replicated*` engines.

- **Distributed tables** shown as primary cards — parsed engine config shows cluster, underlying table, shard key
- **Linked replicated table** metadata: partition key, sort key, TTL (extracted from `CREATE TABLE` DDL)
- **Schema section** — lazy-loaded column list with types, defaults, comments (fetched on expand)
- **Orphaned replicated tables** shown as secondary cards when no Distributed table links to them
- **Search** — filter by table name or database
- **Pin** — pin hot tables to the top (persisted in `localStorage`)

---

### Replication
`system.replicas` + `system.replication_queue`.

- **Summary bar**: total tables, issues count, total queue depth, max delay — all with descriptions
- **Active queue banner** — shows in-flight replication tasks with type badges (`GET_PART`, `MERGE_PARTS`, `MUTATE_PART`, etc.)
- **Expandable table cards** — per-replica detail: queue breakdown (inserts / merges / mutations), replication log gap, parts health, ZK paths, exception messages
- **Search** — filter by table or database name
- **Pin** — pin tables to top (separate pin state from Tables tab)

---

### ZooKeeper
`system.zookeeper_connection` + `system.zookeeper` + `system.replicas`.

- **Ensemble connections** — host cards showing state (`Connected` / `Standby` / `SessionExpired`), API version, outstanding requests, session ID
- **How ZK works** — explanation of leader election, replication log, part registry, distributed DDL
- **Table ZK registry** — per-table ZK paths, log gap, queue size, absolute delay, exception messages
- **Path explorer** — lazy-loading ZK tree with descriptions for well-known paths (`/clickhouse/tables`, `/clickhouse/task_queue`, etc.)
- **Search + pin** on the table registry (separate `localStorage` key)

---

### Metrics
`system.metrics` + `system.events` + `system.asynchronous_metrics`. Polled every 15 seconds.

- **Pause / Resume** button — stops polling so the page doesn't generate continuous queries (useful on busy clusters or when sharing your screen)
- Status line shows time of last snapshot and "Paused — showing last snapshot" when paused

11 metric groups, each with SVG sparklines, current value, warn/danger thresholds:

| Group | Key metrics |
|-------|------------|
| Query Performance | Active queries, QPS, select/insert rates, failed queries |
| Memory | Resident RAM, virtual memory, uncompressed/mark cache |
| CPU & Threads | OS load averages (1/5/15m), total threads, runnable threads |
| Merges & Parts | Active merges, max parts per partition, rows/bytes merged/s |
| Replication | Max replication lag, total merges queued, total inserts queued |
| Connections | TCP, HTTP, interserver connections |
| Ingestion | Rows inserted/s, bytes inserted/s |
| Disk I/O | Read/write bytes/s |
| Network | Send/receive bytes/s |
| Locks | Lock contentions/s |
| Background Work | Background pool tasks, moves, fetches |

---

### About drawer
Click the **About** button (top-right of the tab bar) on any tab to open a contextual help drawer. For each tab it shows:
- What the view is and where the data comes from
- Why it matters operationally
- Specific signals to watch for (info / warning / danger)
- Collapsible SQL blocks for every backend query the tab runs

### Query Docs
Auto-rendered from `QUERIES.md` — documents all SQL queries the dashboard executes, with purpose, full SQL, and output column descriptions.

---

## Troubleshooting

**"Request failed with status code 401"**
Your username or password is wrong. Try `default` / _(blank)_.

**"Request failed with status code 404"**
The queried system table doesn't exist on your ClickHouse version.
- `system.zookeeper_connection` requires ClickHouse 22.6+
- `system.zookeeper` requires ZooKeeper/Keeper to be configured

**"Network Error" or connection refused**
- Make sure the proxy server is running on port 3001
- Make sure your ClickHouse host is reachable from your machine on port 8123
- If ClickHouse is behind a VPN or firewall, connect to it first

**Port already in use**
```bash
# kill whatever is on port 3001 or 5173
lsof -ti:3001 | xargs kill
lsof -ti:5173 | xargs kill
```

**Metrics page shows "—" for all values**
Some async metrics from ClickHouse come back as strings (`"NaN"`, `"Inf"`). The dashboard handles these gracefully and displays `—`. This is not an error.

---

## ClickHouse version compatibility

| Feature | Min version |
|---------|------------|
| Core dashboard (Topology, Tables, Replication, Metrics) | 21.x+ |
| ZooKeeper connection panel (`system.zookeeper_connection`) | 22.6+ |
| ZooKeeper path explorer (`system.zookeeper`) | 21.x+ (requires ZK configured) |
