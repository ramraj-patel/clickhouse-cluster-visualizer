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

---

## 10. Query Log

**Functions:** `fetchQueryLog`, `fetchQueryLogFilterOptions`, `fetchQuerySubQueries`, `fetchQueryThreadDetail`, `fetchTableHotspots`, `fetchCrossShardBreakdown`
**Source table:** `system.query_log`, `system.query_thread_log`
**Used by:** Query Log tab
**Proxy timeout:** 30 seconds (increased from default 15s)

### 10a. Top-level queries

```sql
SELECT
  query_id, initial_query_id, is_initial_query,
  event_time,
  query_duration_ms,
  query, user, current_database,
  read_rows, read_bytes, written_rows, result_rows, result_bytes,
  memory_usage,
  exception, exception_code, type, initial_user, interface, client_name,
  databases, tables,
  ProfileEvents['SelectedMarks']           AS marks_read,
  ProfileEvents['SelectedRanges']          AS ranges_selected,
  ProfileEvents['RealTimeMicroseconds']    AS real_time_us,
  ProfileEvents['UserTimeMicroseconds']    AS user_time_us,
  ProfileEvents['SystemTimeMicroseconds']  AS system_time_us,
  ProfileEvents['ReadCompressedBytes']     AS read_compressed_bytes,
  length(thread_ids)                       AS thread_count
FROM system.query_log
WHERE type IN ('QueryFinish', 'ExceptionBeforeStart', 'ExceptionWhileProcessing')
  AND is_initial_query = 1
  AND event_time >= now() - INTERVAL {intervalMinutes} MINUTE
  AND query NOT ILIKE 'DESC %'
  AND query NOT ILIKE 'DESCRIBE %'
  -- optional: AND query NOT ILIKE '%exclude_pattern%'  (per excluded pattern)
  -- optional: AND (current_database IN (...) OR arrayExists(t -> splitByChar('.', t)[1] IN (...), tables))
  -- optional: AND arrayExists(t -> t IN (...), tables)
  -- optional: AND query ILIKE '%search_term%'
ORDER BY event_time DESC
LIMIT {limit}
```

**Parameters:**
- `intervalMinutes` — configurable: 5, 10, 15, 30, 60 (default), 360, 1440 minutes
- `limit` — 100, 200 (default), or 500
- Exclude patterns — per-pattern `AND query NOT ILIKE '%pattern%'` clauses
- Database filter — `AND (current_database IN (...) OR arrayExists(t -> splitByChar('.', t)[1] IN (...), tables))`
- Table filter — `AND arrayExists(t -> t IN (...), tables)`
- Search — `AND query ILIKE '%term%'`

**Purpose:**
Retrieves completed queries for the selected time window. All filters are applied server-side in SQL. `is_initial_query = 1` restricts to top-level queries; distributed sub-queries appear in the Tier 1 panel. `type NOT 'QueryStart'` keeps only completed or failed entries.

**Output columns:**

| Column                 | Type     | Description                                                                   |
|------------------------|----------|-------------------------------------------------------------------------------|
| `query_id`             | String   | Unique query identifier                                                       |
| `initial_query_id`     | String   | Parent query ID (same as `query_id` for top-level queries)                    |
| `is_initial_query`     | UInt8    | `1` for top-level queries                                                     |
| `event_time`           | DateTime | When the query completed                                                      |
| `query_duration_ms`    | UInt64   | Wall-clock query duration in milliseconds                                     |
| `query`                | String   | Full query text (may be truncated at 64 KB)                                   |
| `user`                 | String   | ClickHouse user who ran the query                                             |
| `current_database`     | String   | Default database at query time                                                |
| `read_rows`            | UInt64   | Total rows read from storage                                                  |
| `read_bytes`           | UInt64   | Total uncompressed bytes read                                                 |
| `memory_usage`         | Int64    | Peak memory used by this query                                                |
| `type`                 | Enum     | `QueryFinish`, `ExceptionBeforeStart`, or `ExceptionWhileProcessing`          |
| `exception`            | String   | Error message (empty for successful queries)                                  |
| `exception_code`       | Int32    | ClickHouse error code (0 for success)                                         |
| `databases`            | Array    | Databases accessed                                                            |
| `tables`               | Array    | Tables accessed (as `db.table` strings)                                       |
| `client_name`          | String   | Client application name                                                       |
| `marks_read`           | UInt64   | Index marks scanned — proxy for sparse index efficiency                       |
| `real_time_us`         | UInt64   | Wall-clock microseconds (from ProfileEvents)                                  |
| `user_time_us`         | UInt64   | User-space CPU microseconds                                                   |
| `system_time_us`       | UInt64   | Kernel-space CPU microseconds                                                 |
| `thread_count`         | UInt64   | Number of threads used (`length(thread_ids)`)                                 |

---

### 10b. Filter options (databases & tables)

**Function:** `fetchQueryLogFilterOptions`

```sql
-- Databases (union current_database + DB prefix from tables array)
SELECT DISTINCT v FROM (
  SELECT current_database AS v
  FROM system.query_log
  WHERE event_time >= now() - INTERVAL {intervalMinutes} MINUTE
    AND type IN ('QueryFinish', 'ExceptionBeforeStart', 'ExceptionWhileProcessing')
    AND is_initial_query = 1
    AND current_database != ''
  UNION ALL
  SELECT arrayJoin(arrayMap(t -> splitByChar('.', t)[1], tables)) AS v
  FROM system.query_log
  WHERE event_time >= now() - INTERVAL {intervalMinutes} MINUTE
    AND type IN ('QueryFinish', 'ExceptionBeforeStart', 'ExceptionWhileProcessing')
    AND is_initial_query = 1
    AND notEmpty(tables)
) WHERE v != ''
ORDER BY v LIMIT 300;

-- Tables
SELECT DISTINCT arrayJoin(tables) AS v
FROM system.query_log
WHERE event_time >= now() - INTERVAL {intervalMinutes} MINUTE
  AND type IN ('QueryFinish', 'ExceptionBeforeStart', 'ExceptionWhileProcessing')
  AND is_initial_query = 1
  AND notEmpty(tables)
ORDER BY v LIMIT 500
```

**Purpose:**
Populates the Database and Table multiselect dropdowns. Both use the same time window as the main query. Databases include both `current_database` (the session default) and the DB prefix extracted from `tables` entries (e.g. `system` from `system.query_log`) — this ensures databases like `system` appear even when `current_database = 'default'`.

---

### 10c. Sub-queries (Tier 1)

**Function:** `fetchQuerySubQueries`

```sql
SELECT
  query_id, initial_query_id, is_initial_query,
  event_time, query_duration_ms, query, user, current_database,
  read_rows, read_bytes, 0 AS written_rows, result_rows, 0 AS result_bytes,
  memory_usage, exception, 0 AS exception_code,
  type, '' AS initial_user, '' AS interface, '' AS client_name,
  ProfileEvents['SelectedMarks']           AS marks_read,
  0 AS ranges_selected,
  ProfileEvents['RealTimeMicroseconds']    AS real_time_us,
  ProfileEvents['UserTimeMicroseconds']    AS user_time_us,
  ProfileEvents['SystemTimeMicroseconds']  AS system_time_us,
  0 AS read_compressed_bytes,
  length(thread_ids)                       AS thread_count
FROM system.query_log
WHERE initial_query_id = '<query_id>'
  AND is_initial_query = 0
ORDER BY event_time ASC
```

**Purpose:**
For a distributed query, ClickHouse fans out sub-queries to remote shards. This query fetches those sub-queries by `initial_query_id`. Sub-queries have `is_initial_query = 0`. Loaded automatically when the user expands a query detail panel.

---

### 10d. Thread detail (Tier 2)

**Function:** `fetchQueryThreadDetail`
**Requires:** `log_query_threads = 1` in `config.xml` or `users.xml`

```sql
SELECT
  thread_name, thread_id,
  read_rows, read_bytes, memory_usage,
  ProfileEvents['RealTimeMicroseconds']   AS real_us,
  ProfileEvents['UserTimeMicroseconds']   AS user_us,
  ProfileEvents['SystemTimeMicroseconds'] AS sys_us,
  ProfileEvents['SelectedMarks']          AS marks_read
FROM system.query_thread_log
WHERE query_id = '<query_id>'
ORDER BY real_us DESC
```

**Purpose:**
Per-thread breakdown for a single query. Reveals thread imbalance and parallelism efficiency. Requires `log_query_threads = 1` — without this setting `system.query_thread_log` is not populated and the panel shows an explanatory empty state.

**Output columns:**

| Column        | Type   | Description                                         |
|---------------|--------|-----------------------------------------------------|
| `thread_name` | String | Thread name (e.g. `QueryPipeline`, `MergeThread`)  |
| `thread_id`   | UInt64 | OS thread ID                                        |
| `real_us`     | UInt64 | Wall-clock microseconds for this thread             |
| `user_us`     | UInt64 | User-space CPU microseconds                         |
| `sys_us`      | UInt64 | Kernel-space CPU microseconds                       |
| `marks_read`  | UInt64 | Index marks scanned by this thread                  |
| `read_rows`   | UInt64 | Rows read by this thread                            |
| `memory_usage`| Int64  | Memory used by this thread                          |

---

### 10e. Table hotspots

**Function:** `fetchTableHotspots`

```sql
SELECT
  arrayJoin(tables)      AS table_name,
  count()                AS query_count,
  sum(query_duration_ms) AS total_duration_ms,
  sum(read_rows)         AS total_rows_read,
  sum(read_bytes)        AS total_bytes_read
FROM system.query_log
WHERE event_time >= now() - INTERVAL 1 HOUR
  AND is_initial_query = 1
  AND type = 'QueryFinish'
  AND notEmpty(tables)
GROUP BY table_name
ORDER BY query_count DESC
LIMIT 20
```

**Purpose:**
Aggregates the last hour of query activity by table. `arrayJoin(tables)` expands multi-table queries so each table gets individual credit. Shows which tables absorb the most cumulative I/O — useful for identifying candidates for materialised views, better indexes, or pre-aggregation.

**Output columns:**

| Column              | Type   | Description                                       |
|---------------------|--------|---------------------------------------------------|
| `table_name`        | String | Fully qualified table name (e.g. `db.table`)      |
| `query_count`       | UInt64 | Number of queries that touched this table         |
| `total_duration_ms` | UInt64 | Cumulative query duration in milliseconds         |
| `total_rows_read`   | UInt64 | Cumulative rows read from this table              |
| `total_bytes_read`  | UInt64 | Cumulative bytes read from this table             |

---

### 10f. Cross-shard breakdown (Tier 3, opt-in)

**Function:** `fetchCrossShardBreakdown`

```sql
SELECT
  _shard_num,
  hostname()                              AS host,
  query_id,
  query_duration_ms,
  read_rows, read_bytes, memory_usage,
  ProfileEvents['SelectedMarks']          AS marks_read,
  ProfileEvents['RealTimeMicroseconds']   AS real_us,
  ProfileEvents['UserTimeMicroseconds']   AS user_us,
  length(thread_ids)                      AS thread_count
FROM clusterAllReplicas('<cluster_name>', system.query_log)
WHERE initial_query_id = '<query_id>'
ORDER BY _shard_num
```

**Purpose:**
Gathers `query_log` entries from **all replicas in a named cluster** for a specific `initial_query_id`. Allows comparison of per-shard load, duration, and memory for a distributed query. Expensive — fans out to every node — and is opt-in. The user selects a cluster from a dropdown (populated via `fetchClusters`) and clicks "Load all shards". Proxy timeout is 30s.

**Output columns:**

| Column              | Type   | Description                                                  |
|---------------------|--------|--------------------------------------------------------------|
| `_shard_num`        | UInt32 | Shard number (injected by `clusterAllReplicas`)              |
| `host`              | String | Hostname of the node where this log entry was recorded       |
| `query_id`          | String | The sub-query ID on this shard                               |
| `query_duration_ms` | UInt64 | Duration on this shard in milliseconds                       |
| `read_rows`         | UInt64 | Rows read on this shard                                      |
| `read_bytes`        | UInt64 | Bytes read on this shard                                     |
| `memory_usage`      | Int64  | Peak memory on this shard                                    |
| `marks_read`        | UInt64 | Index marks scanned on this shard                            |
| `real_us`           | UInt64 | Wall-clock microseconds on this shard                        |
| `thread_count`      | UInt64 | Threads used on this shard                                   |

---

## 11. Parts Inspector

**Functions:** `fetchPartsSummary`, `fetchPartsForTable`, `fetchActiveMerges`, `fetchPartLog`
**Source tables:** `system.parts`, `system.merges`, `system.part_log`
**Used by:** Parts tab

### 11a. Parts summary (always-fetched)

```sql
SELECT
  database, table,
  count()                       AS total_parts,
  countIf(active)               AS active_parts,
  sum(bytes_on_disk)            AS compressed_bytes,
  sum(data_uncompressed_bytes)  AS uncompressed_bytes,
  sum(rows)                     AS total_rows,
  max(refcount)                 AS max_refcount,
  max(modification_time)        AS last_modified,
  countIf(NOT active)           AS inactive_parts
FROM system.parts
GROUP BY database, table
ORDER BY compressed_bytes DESC
```

**Purpose:**
Aggregated summary per table — always fetched on tab load. Returns a single row per table regardless of partition count, avoiding JSON serialisation of potentially millions of part rows.

**Output columns:**

| Column              | Type     | Description                                                       |
|---------------------|----------|-------------------------------------------------------------------|
| `total_parts`       | UInt64   | All parts (active + inactive)                                     |
| `active_parts`      | UInt64   | Currently visible parts (used by queries)                         |
| `compressed_bytes`  | UInt64   | On-disk compressed size (`bytes_on_disk`)                         |
| `uncompressed_bytes`| UInt64   | Uncompressed logical size (`data_uncompressed_bytes`)             |
| `total_rows`        | UInt64   | Total row count across all active parts                           |
| `max_refcount`      | UInt32   | Highest reference count — elevated when parts are in snapshots    |
| `inactive_parts`    | UInt64   | Parts awaiting GC after merge (should drop to 0 quickly)          |

**Health thresholds:**
- `avg_parts_per_partition > 100` → warn; `> 300` → danger
- `unmerged_parts > 50` → warn; `> 150` → danger
- `compression_ratio < 2` → warn (uncompressed/compressed)
- `max_refcount > 1` → info

---

### 11b. Parts detail (lazy, per table)

```sql
SELECT
  partition, name, active, rows,
  bytes_on_disk, data_uncompressed_bytes,
  refcount, modification_time, min_date, max_date,
  min_block_number, max_block_number, level
FROM system.parts
WHERE database = '<db>' AND table = '<table>'
ORDER BY partition, min_block_number
LIMIT 5000
```

**Purpose:**
Per-partition and per-part detail, loaded lazily when the user drills into a specific table. Capped at 5000 rows to prevent UI freezes on tables with many partitions.

---

### 11c. Active merges

```sql
SELECT
  database, table, partition, result_part_name,
  elapsed, progress, num_parts,
  rows_read, rows_written,
  total_size_bytes_compressed, memory_usage
FROM system.merges
ORDER BY elapsed DESC
```

**Purpose:**
Real-time snapshot of currently executing merge operations. Polled every 15 seconds. Shows progress (0–1 fraction), elapsed time, and memory consumption per merge.

**Output columns:**

| Column                       | Type    | Description                                          |
|------------------------------|---------|------------------------------------------------------|
| `progress`                   | Float64 | Completion fraction 0.0–1.0                          |
| `elapsed`                    | Float64 | Seconds since merge started                          |
| `num_parts`                  | UInt64  | Number of source parts being merged                  |
| `total_size_bytes_compressed`| UInt64  | Total compressed size of source parts                |
| `memory_usage`               | UInt64  | Current memory used by this merge                    |

---

### 11d. Part event history

```sql
SELECT
  event_type, event_time, database, table, partition_id,
  part_name, rows, size_in_bytes, duration_ms, error
FROM system.part_log
WHERE database = '<db>' AND table = '<table>'
ORDER BY event_time DESC
LIMIT 200
```

**Purpose:**
Historical log of part lifecycle events: `NewPart` (insert), `MergeParts` (merge complete), `RemovePart` (GC), `MutatePart` (mutation). Useful for diagnosing why part counts spiked or whether merges are completing successfully. Loaded on demand per table.

---

## 12. Process Monitor

**Function:** `fetchProcesses`
**Source table:** `system.processes`
**Used by:** Processes tab
**Refresh interval:** 5 seconds / stale time: 4 seconds

```sql
SELECT
  query_id, user, client_hostname, elapsed,
  read_rows, read_bytes, total_rows_approx,
  written_rows, memory_usage, peak_memory_usage,
  query, is_cancelled, thread_ids,
  ProfileEvents, Settings
FROM system.processes
ORDER BY elapsed DESC
```

**Purpose:**
Live view of all queries currently executing on this node. Every poll returns a fresh snapshot — rows not present in the current result have already completed. The UI self-filters any process whose `query` text contains `system.processes` to hide the monitoring query itself.

**Output columns:**

| Column              | Type     | Description                                              |
|---------------------|----------|----------------------------------------------------------|
| `query_id`          | String   | Unique query identifier (links to Query Log)             |
| `user`              | String   | ClickHouse user running the query                        |
| `client_hostname`   | String   | Hostname of the client application                       |
| `elapsed`           | Float64  | Seconds since query started                              |
| `read_rows`         | UInt64   | Rows read so far                                         |
| `read_bytes`        | UInt64   | Bytes read so far                                        |
| `total_rows_approx` | UInt64   | Estimated total rows (0 if unknown — indeterminate bar)  |
| `written_rows`      | UInt64   | Rows written (for INSERT queries)                        |
| `memory_usage`      | Int64    | Current memory (bytes)                                   |
| `peak_memory_usage` | Int64    | Peak memory since query started                          |
| `is_cancelled`      | UInt8    | `1` if the query received a cancel signal                |
| `thread_ids`        | Array    | OS thread IDs assigned to this query                     |

**Cross-linking:** The "View in Log" button in the Process Monitor card sets `filterQueryId` in the Dashboard state and navigates to the Query Log tab, which pre-filters by that `query_id`.

---

## 13. Mutations Tracker

**Function:** `fetchMutations`
**Source table:** `system.mutations`
**Used by:** Mutations tab
**Refresh interval:** 30 seconds / stale time: 15 seconds

```sql
SELECT
  database, table, mutation_id, command,
  create_time, block_numbers.partition_id,
  parts_to_do_names, parts_to_do,
  is_done, latest_failed_part,
  latest_fail_time, latest_fail_reason
FROM system.mutations
ORDER BY create_time DESC
LIMIT 200
```

**Purpose:**
Shows all mutations (ALTER UPDATE, ALTER DELETE, MATERIALIZE INDEX, MATERIALIZE PROJECTION) on the current node. Mutations run asynchronously part-by-part — `parts_to_do` counts remaining parts. `is_done = 1` with `parts_to_do = 0` means the mutation has completed. Failed mutations (non-empty `latest_fail_reason`) stall all subsequent mutations on that table until manually investigated.

**Output columns:**

| Column                  | Type     | Description                                                              |
|-------------------------|----------|--------------------------------------------------------------------------|
| `mutation_id`           | String   | Unique mutation identifier (e.g. `mutation_42`)                          |
| `command`               | String   | The ALTER command that triggered this mutation                           |
| `create_time`           | DateTime | When the mutation was submitted                                          |
| `parts_to_do`           | Int64    | Parts still needing mutation (0 = done)                                  |
| `parts_to_do_names`     | Array    | Names of parts not yet mutated (useful for stuck diagnosis)              |
| `is_done`               | UInt8    | `1` if the mutation has finished on this replica                         |
| `latest_failed_part`    | String   | Name of the part that last caused a failure                              |
| `latest_fail_time`      | DateTime | Timestamp of the last failure                                            |
| `latest_fail_reason`    | String   | Error message from the last failure (empty when healthy)                 |

---

## 14. Disk Health

**Function:** `fetchDiskHealth`
**Source table:** `system.disks`
**Used by:** Dashboard header (disk warning badge), Parts tab
**Refresh interval:** 30 seconds

```sql
SELECT
  name, path, type,
  free_space, total_space, used_fraction,
  keep_free_space
FROM system.disks
ORDER BY used_fraction DESC
```

**Purpose:**
Returns all configured storage volumes (default disk, additional volumes for tiered storage, S3 disks). `used_fraction` is the primary health signal — values above 0.85 trigger a warning badge in the header; above 0.95 triggers a critical (red) badge.

**Output columns:**

| Column           | Type    | Description                                             |
|------------------|---------|---------------------------------------------------------|
| `name`           | String  | Disk/volume name as configured                          |
| `path`           | String  | Filesystem path                                         |
| `type`           | String  | `local`, `s3`, `hdfs`, `azure_blob_storage`, etc.       |
| `free_space`     | UInt64  | Available bytes                                         |
| `total_space`    | UInt64  | Total capacity bytes                                    |
| `used_fraction`  | Float64 | `1 - (free_space / total_space)` — 0.0 to 1.0          |
| `keep_free_space`| UInt64  | Reserved bytes (ClickHouse will not fill below this)    |

---

## 15. Server Errors

**Function:** `fetchServerErrors`
**Source table:** `system.errors`
**Used by:** Dashboard header (error count badge)
**Refresh interval:** 30 seconds

```sql
SELECT
  name, code, value, last_error_time, last_error_message
FROM system.errors
WHERE value > 0
ORDER BY value DESC
LIMIT 50
```

**Purpose:**
Returns error types that have occurred at least once since server start, ordered by frequency. The dashboard header shows the count of distinct error types and total occurrences. Clicking the badge is informational — errors should be investigated in the Query Log for specific failing queries.

**Output columns:**

| Column               | Type     | Description                                              |
|----------------------|----------|----------------------------------------------------------|
| `name`               | String   | Error name (e.g. `MEMORY_LIMIT_EXCEEDED`)                |
| `code`               | Int32    | ClickHouse error code                                    |
| `value`              | UInt64   | Total occurrences since server start                     |
| `last_error_time`    | DateTime | Timestamp of the most recent occurrence                  |
| `last_error_message` | String   | Full error message from the last occurrence              |

---

## Refresh Behaviour

| Query group                                     | Interval   | Stale time | Notes |
|-------------------------------------------------|------------|------------|-------|
| Cluster, Replicas, Tables, Replication Queue    | 30 seconds | 10 seconds | Driven by `useClusterData` |
| Disk health, Server errors                      | 30 seconds | 10 seconds | Driven by `useClusterData`; header badge signals |
| Active merges (Parts tab)                       | 15 seconds | 10 seconds | Driven by `useActiveMerges` |
| Parts summary (Parts tab)                       | 60 seconds | 30 seconds | Driven by `usePartsSummary`; aggregated GROUP BY only |
| Metrics (queries 7–9: metrics, events, async)   | 15 seconds | 14 seconds | Driven by `useMetricsHistory`; can be paused via the Pause button |
| Process Monitor                                 | 5 seconds  | 4 seconds  | Driven by `useProcesses`; live in-flight queries |
| Mutations Tracker                               | 30 seconds | 15 seconds | Driven by `useMutations` |
| Query Log                                       | On demand / optional auto-refresh | 30s | Auto-refresh disabled by default; user can enable with configurable interval |
| ZooKeeper connections (`system.zookeeper_connection`) | 30 seconds | 15 seconds | Stops retrying on 404 (ClickHouse < 22.6) |
| ZooKeeper tree nodes (`system.zookeeper`)       | On demand  | 30 seconds | One query per node expansion; not auto-polled |

**Proxy timeout:** Increased from 15s to 30s in `config/server.ts` to accommodate Query Log queries and the opt-in `clusterAllReplicas()` cross-shard fetch.

The ZooKeeper tree is not auto-polled since each node expansion is a separate live read against ZooKeeper. If `system.zookeeper_connection` returns 404 (requires ClickHouse 22.6+), the panel shows a graceful error and stops retrying.
