# ClickHouse Cluster Visualizer — Query Reference

All queries are issued via HTTP POST to the ClickHouse HTTP interface (`http://<host>:<port>/`) with `FORMAT JSON` appended. They are forwarded through the local Express proxy (`server.ts`) to avoid browser CORS restrictions. Every query is read-only and targets `system.*` tables — no data is written.

Most queries refresh every **30 seconds**. Metrics queries (7–9) use a separate **15-second** poll interval to keep sparklines smooth.

---

## 1. Connection Test

**Function:** `testConnection`
**Trigger:** Once, on clicking "Connect"

```sql
SELECT version() AS version
```

**Purpose:**
Validates that the supplied credentials are correct and the host is reachable before loading the dashboard. Returns the ClickHouse server version string (e.g. `24.8.4.13`), which is displayed in the header.

**Output columns:**

| Column    | Type   | Description                        |
|-----------|--------|------------------------------------|
| `version` | String | ClickHouse server version string   |

---

## 2. Cluster Topology

**Function:** `fetchClusters`
**Source table:** `system.clusters`
**Used by:** Topology tab, header stats (Clusters / Shards / Replicas)

```sql
SELECT
  cluster, shard_num, shard_weight, replica_num,
  host_name, host_address, port, is_local,
  user, default_database, errors_count,
  slowdowns_count, estimated_recovery_time
FROM system.clusters
ORDER BY cluster, shard_num, replica_num
```

**Purpose:**
Retrieves the complete cluster topology as defined in the server's `<remote_servers>` config (or Keeper-managed cluster definitions). Each row represents one replica slot within a shard within a named cluster. This data drives the React Flow graph — clusters become labelled groups, shards become boxes, and each replica becomes a node colour-coded by health.

**Output columns:**

| Column                    | Type    | Description                                                              |
|---------------------------|---------|--------------------------------------------------------------------------|
| `cluster`                 | String  | Name of the cluster (e.g. `my_cluster`)                                  |
| `shard_num`               | UInt32  | 1-based shard index within the cluster                                   |
| `shard_weight`            | UInt32  | Relative weight used for distributed writes                              |
| `replica_num`             | UInt32  | 1-based replica index within the shard                                   |
| `host_name`               | String  | Hostname of the replica as configured                                    |
| `host_address`            | String  | Resolved IP address of the replica                                       |
| `port`                    | UInt16  | TCP port the replica listens on                                          |
| `is_local`                | UInt8   | `1` if this row refers to the node being queried                         |
| `user`                    | String  | Username used for inter-replica connections                              |
| `default_database`        | String  | Default database for distributed queries                                 |
| `errors_count`            | UInt32  | Cumulative connection/query errors to this replica                       |
| `slowdowns_count`         | UInt32  | Number of times this replica was deprioritised due to slowness           |
| `estimated_recovery_time` | UInt32  | Seconds until the replica is expected to recover (0 = healthy)           |

**Health derivation:**
A replica node is coloured red if `errors_count > 5`, yellow if any `system.replicas` row for that host shows `is_readonly = 1` or `absolute_delay > 300s`, and green otherwise.

---

## 3. Replica Health

**Function:** `fetchReplicas`
**Source table:** `system.replicas`
**Used by:** Topology tab (health colouring), Replication tab, header unhealthy count

```sql
SELECT
  database, table, engine, is_leader, can_become_leader,
  is_readonly, is_session_expired, future_parts, parts_to_check,
  zookeeper_path, replica_name, replica_path,
  queue_size, inserts_in_queue, merges_in_queue, part_mutations_in_queue,
  queue_oldest_time, inserts_oldest_time, merges_oldest_time,
  log_max_index, log_pointer, absolute_delay,
  total_replicas, active_replicas,
  last_queue_update_exception, zookeeper_exception
FROM system.replicas
ORDER BY database, table
```

**Purpose:**
Returns one row per replicated table per replica on the **current node**. This is the primary source for replica health signals: read-only state, replication lag, queue depth, and ZooKeeper connectivity issues. The Replication tab displays this grouped by table; the Topology tab uses it to colour-code replica nodes.

**Output columns:**

| Column                      | Type    | Description                                                                 |
|-----------------------------|---------|-----------------------------------------------------------------------------|
| `database`                  | String  | Database the table belongs to                                               |
| `table`                     | String  | Table name                                                                  |
| `engine`                    | String  | Storage engine (e.g. `ReplicatedMergeTree`)                                 |
| `is_leader`                 | UInt8   | `1` if this replica is currently the leader for merges                      |
| `can_become_leader`         | UInt8   | `1` if this replica is eligible to become leader                            |
| `is_readonly`               | UInt8   | `1` if the replica is in read-only mode (writes rejected)                   |
| `is_session_expired`        | UInt8   | `1` if the ZooKeeper session has expired                                    |
| `future_parts`              | UInt32  | Parts expected after currently active merges/mutations complete             |
| `parts_to_check`            | UInt32  | Parts in the verification queue                                             |
| `zookeeper_path`            | String  | ZooKeeper path for the table's replication log                              |
| `replica_name`              | String  | This replica's name (typically the hostname)                                |
| `replica_path`              | String  | Full ZooKeeper path for this specific replica                               |
| `queue_size`                | UInt32  | Total entries in the replication queue                                      |
| `inserts_in_queue`          | UInt32  | Pending INSERT operations in the queue                                      |
| `merges_in_queue`           | UInt32  | Pending MERGE operations in the queue                                       |
| `part_mutations_in_queue`   | UInt32  | Pending ALTER UPDATE/DELETE mutations in the queue                          |
| `queue_oldest_time`         | DateTime| Timestamp of the oldest task in the replication queue                       |
| `inserts_oldest_time`       | DateTime| Timestamp of the oldest pending INSERT task                                 |
| `merges_oldest_time`        | DateTime| Timestamp of the oldest pending MERGE task                                  |
| `log_max_index`             | UInt64  | Highest log entry index in ZooKeeper                                        |
| `log_pointer`               | UInt64  | Last log entry this replica has applied                                     |
| `absolute_delay`            | UInt64  | Replication lag in seconds relative to the most up-to-date replica         |
| `total_replicas`            | UInt8   | Total configured replicas for this table                                    |
| `active_replicas`           | UInt8   | Replicas currently active in ZooKeeper                                      |
| `last_queue_update_exception` | String | Last error encountered while updating the replication queue               |
| `zookeeper_exception`       | String  | Last ZooKeeper error (empty when healthy)                                   |

---

## 4. Distributed & Replicated Tables

**Function:** `fetchDistributedTables`
**Source table:** `system.tables`
**Used by:** Tables tab

```sql
SELECT
  database, name, engine, engine_full,
  create_table_query, partition_key, sorting_key, primary_key,
  total_rows, total_bytes
FROM system.tables
WHERE engine IN (
  'Distributed',
  'ReplicatedMergeTree',
  'ReplicatedReplacingMergeTree',
  'ReplicatedAggregatingMergeTree',
  'ReplicatedCollapsingMergeTree',
  'ReplicatedVersionedCollapsingMergeTree',
  'ReplicatedSummingMergeTree'
)
ORDER BY database, name
```

**Purpose:**
Lists all tables that participate in distributed or replicated operations. `Distributed` tables are shown as primary entries in the UI. Each Distributed table's `engine_full` is parsed to extract the target cluster, underlying database/table, and shard key. The corresponding `Replicated*` table's metadata (partition key, sort key, TTL) is looked up by matching the parsed target name. TTL is extracted via regex from `create_table_query`.

**Output columns:**

| Column              | Type    | Description                                                                  |
|---------------------|---------|------------------------------------------------------------------------------|
| `database`          | String  | Database the table lives in                                                  |
| `name`              | String  | Table name                                                                   |
| `engine`            | String  | Short engine name (e.g. `Distributed`, `ReplicatedMergeTree`)                |
| `engine_full`       | String  | Full engine definition including parameters (cluster, shard key, ZK path, etc.) |
| `create_table_query`| String  | Full `CREATE TABLE` DDL — used to extract TTL expression via regex           |
| `partition_key`     | String  | `PARTITION BY` expression (empty if not set)                                 |
| `sorting_key`       | String  | `ORDER BY` expression                                                        |
| `primary_key`       | String  | `PRIMARY KEY` if different from sorting key (empty otherwise)                |
| `total_rows`        | UInt64? | Approximate total row count (`NULL` for Distributed tables)                  |
| `total_bytes`       | UInt64? | Approximate on-disk size in bytes (`NULL` for Distributed tables)            |

**Note on NULLs:** `Distributed` engine tables are logical wrappers and do not store data locally, so `total_rows` and `total_bytes` are `NULL` for them. Physical replicated tables report their local shard's data only.

**Distributed engine_full format:**
```
Distributed('cluster_name', 'target_database', 'target_table', sharding_expression)
```
The UI parses this with a regex to display Cluster, Underlying Table, and Shard Key in the card.

---

## 4a. Table Column Schema

**Function:** `fetchTableColumns`
**Source table:** `system.columns`
**Used by:** Tables tab — Schema section (lazy-loaded when a table card is expanded)

```sql
SELECT
  database, table, name, type,
  default_kind, default_expression, comment,
  position
FROM system.columns
WHERE database = '<database>' AND table = '<table>'
ORDER BY position
```

**Purpose:**
Fetches the column definitions for a specific table. Called lazily — only when the user expands the Schema section of a table card. For Distributed tables, columns are fetched from the **underlying replicated table** (resolved by parsing the Distributed engine config), since Distributed tables themselves have no local schema.

**Output columns:**

| Column               | Type   | Description                                                         |
|----------------------|--------|---------------------------------------------------------------------|
| `database`           | String | Database name                                                       |
| `table`              | String | Table name                                                          |
| `name`               | String | Column name                                                         |
| `type`               | String | ClickHouse data type (e.g. `UInt64`, `DateTime`, `Nullable(String)`) |
| `default_kind`       | String | `DEFAULT`, `MATERIALIZED`, `ALIAS`, or empty                        |
| `default_expression` | String | Expression used for the default/materialized/alias value            |
| `comment`            | String | Column-level comment (empty if none)                                |
| `position`           | UInt64 | 1-based ordinal position in the table definition                    |

---

## 5. Replication Queue

**Function:** `fetchReplicationQueue`
**Source table:** `system.replication_queue`
**Used by:** Replication tab (active queue section), tab badge indicator

```sql
SELECT
  database, table, replica_name, position, node_name, type,
  create_time, source_replica, new_part_name,
  is_currently_executing, num_tries, last_attempt_time,
  last_exception
FROM system.replication_queue
ORDER BY database, table, position
LIMIT 200
```

**Purpose:**
Shows the pending and in-progress replication tasks on the current node. Each row is a task the local replica needs to execute to catch up with the replication log — typically fetching a part from another replica, executing a merge, or applying a mutation. Entries with `is_currently_executing = 1` are highlighted in the UI.

**Output columns:**

| Column                  | Type     | Description                                                              |
|-------------------------|----------|--------------------------------------------------------------------------|
| `database`              | String   | Database the table belongs to                                            |
| `table`                 | String   | Table name                                                               |
| `replica_name`          | String   | The replica this queue entry belongs to                                  |
| `position`              | UInt32   | Position in the queue (lower = older)                                    |
| `node_name`             | String   | ZooKeeper node name for this queue entry                                 |
| `type`                  | String   | Task type: `GET_PART`, `MERGE_PARTS`, `DROP_RANGE`, `MUTATE_PART`, etc. |
| `create_time`           | DateTime | When the task was added to the queue                                     |
| `source_replica`        | String   | Which replica to fetch the part from (for `GET_PART` tasks)             |
| `new_part_name`         | String   | Name of the part being produced                                          |
| `is_currently_executing`| UInt8    | `1` if a background thread is actively working on this task             |
| `num_tries`             | UInt32   | How many times execution has been attempted                              |
| `last_attempt_time`     | DateTime | Timestamp of the most recent attempt                                     |
| `last_exception`        | String   | Error message from the last failed attempt (empty on success)            |

**Limit:** Capped at 200 rows to avoid overwhelming the UI on clusters with large backlogs.

---

## 6. ZooKeeper / Keeper Tree

**Function:** `fetchZookeeperNodes`
**Source table:** `system.zookeeper`
**Used by:** ZooKeeper tab (lazy-loaded tree)

```sql
SELECT name, value, numChildren, path
FROM system.zookeeper
WHERE path = '<selected_path>'
```

**Purpose:**
Queries the ZooKeeper (or ClickHouse Keeper) tree one level at a time. The initial call fetches the root `/`; expanding a node triggers a new query for that node's path. This lazy-loading approach avoids fetching the entire tree upfront, which can be very large on active clusters.

`system.zookeeper` is a special table — each query performs a live ZooKeeper read, so it reflects the real-time state of the coordination service.

**Output columns:**

| Column        | Type   | Description                                                           |
|---------------|--------|-----------------------------------------------------------------------|
| `name`        | String | Name of the ZooKeeper node (leaf segment of the path)                |
| `value`       | String | Data stored in the node (often empty for structural/namespace nodes)  |
| `numChildren` | Int32  | Number of direct child nodes (0 = leaf node)                         |
| `path`        | String | Full path of the **parent** directory queried                        |

**Access note:** Requires the ClickHouse user to have ZooKeeper access configured. If unavailable, the tab shows an error explaining the requirement rather than crashing.

---

## 6a. ZooKeeper Connection Status

**Function:** `fetchZookeeperConnections`
**Source table:** `system.zookeeper_connection`
**Used by:** ZooKeeper tab — Ensemble connections panel
**Requires:** ClickHouse 22.6+

```sql
SELECT host, port, index, connected_time, session_id,
       is_expired, keeper_api_version, outstanding_requests, state
FROM system.zookeeper_connection
ORDER BY index
```

**Purpose:**
Returns the list of ZooKeeper (or ClickHouse Keeper) hosts that this ClickHouse node is connected to, along with the session state for each. In a typical ensemble setup, one connection is `Connected` (active) and the rest are `Standby`. An `SessionExpired` or `NotConnected` state means replication will be blocked until reconnection.

**Output columns:**

| Column                | Type     | Description                                                                   |
|-----------------------|----------|-------------------------------------------------------------------------------|
| `host`                | String   | ZooKeeper hostname                                                            |
| `port`                | UInt16   | ZooKeeper client port                                                         |
| `index`               | Int32    | 0-based connection index in the ensemble config                               |
| `connected_time`      | DateTime | When this session was established                                             |
| `session_id`          | String   | ZooKeeper session ID (hex string)                                             |
| `is_expired`          | UInt8    | `1` if the session has expired                                                |
| `keeper_api_version`  | Int32    | Keeper API version negotiated with this host                                  |
| `outstanding_requests`| Int32    | Requests queued but not yet acknowledged (high values indicate ZK lag)        |
| `state`               | String   | `Connected`, `Standby`, `SessionExpired`, or `NotConnected`                  |

---

## 7. Server Metrics (Gauges)

**Function:** `fetchMetrics`
**Source table:** `system.metrics`
**Used by:** Metrics tab — all gauge metrics (Active Queries, Merges, Connections, etc.)

```sql
SELECT metric, value, description
FROM system.metrics
ORDER BY metric
```

**Purpose:**
Instantaneous gauge metrics — values reflect the exact state at the moment of the query. Polled every 15 seconds to build time-series sparklines in the Metrics tab.

**Output columns:**

| Column        | Type   | Description                                               |
|---------------|--------|-----------------------------------------------------------|
| `metric`      | String | Metric name in PascalCase (e.g. `Query`, `TCPConnection`) |
| `value`       | Int64  | Current value of the metric                               |
| `description` | String | Human-readable explanation of what the metric measures    |

---

## 8. Cumulative Event Counters

**Function:** `fetchEvents`
**Source table:** `system.events`
**Used by:** Metrics tab — all rate metrics (QPS, Rows/s, Bytes/s, etc.)

```sql
SELECT event, value, description
FROM system.events
ORDER BY event
```

**Purpose:**
Cumulative monotonically increasing counters that track how many times each event has occurred since the server started. The UI computes per-second rates by dividing the delta between two consecutive polls by the elapsed time: `rate = (current − previous) / interval_seconds`.

**Output columns:**

| Column        | Type   | Description                                                    |
|---------------|--------|----------------------------------------------------------------|
| `event`       | String | Event name (e.g. `Query`, `InsertedRows`, `FailedQuery`)       |
| `value`       | UInt64 | Total occurrences since server start (never resets)            |
| `description` | String | Human-readable explanation                                     |

**Key events used for rates:**

| Event                      | Rate metric shown         |
|----------------------------|---------------------------|
| `Query`                    | QPS (all types)           |
| `SelectQuery`              | Select QPS                |
| `InsertQuery`              | Insert QPS                |
| `FailedQuery`              | Failed QPS                |
| `InsertedRows`             | Rows inserted/s           |
| `InsertedBytes`            | Bytes inserted/s          |
| `SelectedRows`             | Rows read/s               |
| `MergedRows`               | Rows merged/s             |
| `MergedUncompressedBytes`  | Bytes merged/s            |
| `NetworkSendBytes`         | Network out/s             |
| `NetworkReceiveBytes`      | Network in/s              |
| `ContextLock`              | Lock contentions/s        |
| `DiskReadElapsedMicroseconds` | Disk read latency proxy |

---

## 9. Asynchronous Metrics

**Function:** `fetchAsyncMetrics`
**Source table:** `system.asynchronous_metrics`
**Used by:** Metrics tab — CPU, memory, OS-level, replication aggregate stats

```sql
SELECT metric, value, description
FROM system.asynchronous_metrics
ORDER BY metric
```

**Purpose:**
OS-level and server-wide metrics sampled by a background thread every few seconds (not on-demand like `system.metrics`). Includes CPU load, physical memory usage, disk I/O, load averages, cache sizes, and cluster-wide replication aggregates that aren't available in `system.metrics`.

**Output columns:**

| Column        | Type   | Description                                                        |
|---------------|--------|--------------------------------------------------------------------|
| `metric`      | String | Metric name (e.g. `MemoryResident`, `OSLoadAverage1`)              |
| `value`       | Float64| Current sampled value                                              |
| `description` | String | Human-readable explanation                                         |

**Key async metrics surfaced:**

| Metric                        | What it shows                                            |
|-------------------------------|----------------------------------------------------------|
| `MemoryResident`              | Physical RAM used (RSS) — what `top` shows               |
| `MemoryVirtual`               | Virtual address space claimed                            |
| `OSLoadAverage1/5/15`         | 1-, 5-, 15-minute load averages from the OS              |
| `OSThreadsTotal`              | Total OS threads in the ClickHouse process               |
| `OSThreadsRunnable`           | Threads ready to run but waiting for a CPU core          |
| `OSReadBytes` / `OSWriteBytes`| Disk bytes read/written since last sample                |
| `UncompressedCacheBytes`      | Size of the decompressed block cache                     |
| `MarkCacheBytes`              | Size of the mark (index) cache                           |
| `FilesystemCacheBytes`        | Remote storage local cache size                          |
| `MaxPartCountForPartition`    | Largest number of parts in any partition — key health indicator |
| `ReplicasMaxAbsoluteDelay`    | Worst replication lag in seconds across all tables       |
| `ReplicasSumMergesInQueue`    | Total merge tasks queued across all replicated tables    |
| `ReplicasSumInsertsInQueue`   | Total insert replication tasks queued                    |

---

## Refresh Behaviour

| Query group                                     | Interval   | Stale time | Notes |
|-------------------------------------------------|------------|------------|-------|
| Cluster, Replicas, Tables, Replication Queue    | 30 seconds | 10 seconds | Driven by `useClusterData` |
| Metrics (queries 7–9: metrics, events, async)   | 15 seconds | 14 seconds | Driven by `useMetricsHistory`; can be paused via the Pause button |
| ZooKeeper connections (`system.zookeeper_connection`) | 30 seconds | 15 seconds | Stops retrying on 404 (ClickHouse < 22.6) |
| ZooKeeper tree nodes (`system.zookeeper`)       | On demand  | 30 seconds | One query per node expansion; not auto-polled |

The ZooKeeper tree is not auto-polled since each node expansion is a separate live read against ZooKeeper. If `system.zookeeper_connection` returns 404 (requires ClickHouse 22.6+), the panel shows a graceful error and stops retrying.
