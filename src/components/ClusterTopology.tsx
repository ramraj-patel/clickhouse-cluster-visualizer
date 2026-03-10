import { useMemo, useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Panel,
  type Node,
  type Edge,
  type ReactFlowInstance,
  Position,
  MarkerType,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { ChevronDown, Search, X, Check, Copy, ExternalLink } from 'lucide-react'
import { fetchPartsSummary } from '../api/clickhouse'
import { fmtBytes, fmtRows } from '../utils/format'
import { safeNum } from '../api/clickhouse'
import type { ClusterNode, ReplicaInfo, DistributedTable, ConnectionConfig } from '../types'

interface Props {
  clusters: ClusterNode[]
  replicas: ReplicaInfo[]
  tables?: DistributedTable[]
  config?: ConnectionConfig
}

// ─── Copy button ─────────────────────────────────────────────────────────────

function CopyButton({ data }: { data: object }) {
  const [copied, setCopied] = useState(false)

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation()
    const text = JSON.stringify(data, null, 2)
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <button
      onClick={handleCopy}
      title="Copy as JSON"
      style={{
        position: 'absolute', top: 4, right: 4,
        padding: '2px 4px', borderRadius: 4, cursor: 'pointer',
        background: copied ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.06)',
        border: copied ? '1px solid rgba(34,197,94,0.4)' : '1px solid rgba(255,255,255,0.1)',
        color: copied ? '#22c55e' : '#64748b',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.15s',
        opacity: 0.7,
      }}
      onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
      onMouseLeave={e => (e.currentTarget.style.opacity = '0.7')}
    >
      {copied
        ? <Check style={{ width: 10, height: 10 }} />
        : <Copy style={{ width: 10, height: 10 }} />
      }
    </button>
  )
}

// ─── Health helpers ───────────────────────────────────────────────────────────

function nodeReplicas(node: ClusterNode, replicas: ReplicaInfo[]) {
  return replicas.filter(r => r.replica_name === node.host_name)
}

function replicaHealth(node: ClusterNode, replicas: ReplicaInfo[]): 'healthy' | 'degraded' | 'down' {
  if (node.errors_count > 5) return 'down'
  const rs = nodeReplicas(node, replicas)
  if (rs.some(r => r.is_readonly === 1 || r.is_session_expired === 1)) return 'degraded'
  if (rs.some(r => r.absolute_delay > 300)) return 'degraded'
  return 'healthy'
}

function worstShardHealth(shardNodes: ClusterNode[], replicas: ReplicaInfo[]): 'healthy' | 'degraded' | 'down' {
  const healths = shardNodes.map(n => replicaHealth(n, replicas))
  if (healths.includes('down')) return 'down'
  if (healths.includes('degraded')) return 'degraded'
  return 'healthy'
}

// Known ClickHouse built-in / test cluster name patterns
const SYSTEM_CLUSTER_RE = /^test_|_localhost$|^all_groups$|^all_replicas$/

function isSystemCluster(name: string) {
  return SYSTEM_CLUSTER_RE.test(name)
}

const healthColor = { healthy: '#22c55e', degraded: '#f59e0b', down: '#ef4444' }
const healthBg    = {
  healthy: 'rgba(34,197,94,0.08)',
  degraded: 'rgba(245,158,11,0.08)',
  down: 'rgba(239,68,68,0.08)',
}

// ─── Layout constants ────────────────────────────────────────────────────────

const CLUSTERS_PER_ROW  = 2
const CLUSTER_GAP_X     = 60
const CLUSTER_GAP_Y     = 80
const SHARD_WIDTH       = 240
const SHARD_GAP         = 280
const REPLICA_HEIGHT    = 130
const CLUSTER_HEADER_H  = 44
const SHARD_TOP_OFFSET  = 64
const SHARD_INNER_Y     = 62   // y inside shard where first replica starts (below shard header)

// ─── Graph builder ───────────────────────────────────────────────────────────

function buildGraph(clusters: ClusterNode[], replicas: ReplicaInfo[]) {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const nodeToCluster = new Map<string, ClusterNode>()

  // cluster → shard → replicas
  const clusterMap = new Map<string, Map<number, ClusterNode[]>>()
  for (const node of clusters) {
    if (!clusterMap.has(node.cluster)) clusterMap.set(node.cluster, new Map())
    const shardMap = clusterMap.get(node.cluster)!
    if (!shardMap.has(node.shard_num)) shardMap.set(node.shard_num, [])
    shardMap.get(node.shard_num)!.push(node)
  }

  // Pre-compute cluster pixel dimensions
  const dims = new Map<string, { width: number; height: number }>()
  for (const [name, shardMap] of clusterMap.entries()) {
    const width = shardMap.size * SHARD_GAP + 40
    const maxReplicas = Math.max(...[...shardMap.values()].map(n => n.length))
    const shardH = maxReplicas * REPLICA_HEIGHT + SHARD_INNER_Y + 12
    const height = SHARD_TOP_OFFSET + shardH + 20
    dims.set(name, { width, height })
  }

  let col = 0, rowX = 0, rowY = 0, rowHeight = 0
  let rowIndex = 0, twoRowsBottomY = 0, maxX = 0

  for (const [clusterName, shardMap] of clusterMap.entries()) {
    const { width, height } = dims.get(clusterName)!

    if (col > 0 && col % CLUSTERS_PER_ROW === 0) {
      if (rowIndex < 2) twoRowsBottomY = rowY + rowHeight
      rowIndex++
      rowX = 0
      rowY += rowHeight + CLUSTER_GAP_Y
      rowHeight = 0
      col = 0
    }

    const ox = rowX, oy = rowY
    rowHeight = Math.max(rowHeight, height)

    // ── Cluster header node ──────────────────────────────────────────────────
    const isSys = isSystemCluster(clusterName)
    const clusterUnhealthy = [...shardMap.values()].flat()
      .filter(n => replicaHealth(n, replicas) !== 'healthy').length
    const clusterHasQueue = [...shardMap.values()].flat()
      .some(n => nodeReplicas(n, replicas).some(r => r.queue_size > 0))

    const clusterNodeId = `cluster-${clusterName}`

    // Pre-collect full shard+replica detail for the cluster copy payload
    const clusterCopyData = {
      cluster: clusterName,
      type: isSys ? 'system' : 'user',
      shard_count: shardMap.size,
      total_replicas: [...shardMap.values()].flat().length,
      unhealthy_replicas: clusterUnhealthy,
      has_active_replication: clusterHasQueue,
      shards: [...shardMap.entries()].map(([sNum, sNodes]) => {
        const sHealth = worstShardHealth(sNodes, replicas)
        let activeR = 0, totalR = sNodes.length
        for (const n of sNodes) {
          const rs = nodeReplicas(n, replicas)
          if (rs.length > 0) { activeR = rs[0].active_replicas; totalR = rs[0].total_replicas; break }
        }
        return {
          shard: sNum,
          shard_weight: sNodes[0]?.shard_weight ?? 1,
          health: sHealth,
          active_replicas: activeR,
          total_replicas: totalR,
          has_active_replication: sNodes.some(n => nodeReplicas(n, replicas).some(r => r.queue_size > 0)),
          replicas: sNodes.map(n => {
            const rs = nodeReplicas(n, replicas)
            const delay = rs.reduce((m, r) => Math.max(m, r.absolute_delay), 0)
            const queue = rs.reduce((s, r) => s + r.queue_size, 0)
            return {
              host: n.host_name,
              address: `${n.host_address}:${n.port}`,
              replica_num: n.replica_num,
              is_local: n.is_local === 1,
              health: replicaHealth(n, replicas),
              is_leader: rs.some(r => r.is_leader === 1),
              is_readonly: rs.some(r => r.is_readonly === 1),
              zk_session_expired: rs.some(r => r.is_session_expired === 1),
              replication_lag_s: delay,
              queue_depth: queue,
              errors_count: n.errors_count,
            }
          }),
        }
      }),
    }
    nodes.push({
      id: clusterNodeId,
      type: 'default',
      position: { x: ox, y: oy },
      data: {
        label: (
          <div style={{ position: 'relative', width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 28px 0 8px' }}>
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-bold text-[13px] tracking-wide truncate" style={{ color: '#ffcc00' }}>
                {clusterName}
              </span>
              {isSys && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full border flex-shrink-0"
                  style={{ color: '#94a3b8', borderColor: 'rgba(148,163,184,0.3)', background: 'rgba(148,163,184,0.08)' }}>
                  SYSTEM
                </span>
              )}
              {clusterUnhealthy > 0 && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full border flex-shrink-0"
                  style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)' }}>
                  {clusterUnhealthy} ⚠
                </span>
              )}
            </div>
            <CopyButton data={clusterCopyData} />
          </div>
        ),
      },
      style: {
        width,
        height: CLUSTER_HEADER_H,
        background: isSys ? 'rgba(148,163,184,0.04)' : 'rgba(255,204,0,0.06)',
        border: isSys ? '1px solid rgba(148,163,184,0.2)' : '1px solid rgba(255,204,0,0.25)',
        borderRadius: 12,
      },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    })

    // ── Shard nodes ──────────────────────────────────────────────────────────
    let shardX = ox + 20
    for (const [shardNum, shardNodes] of shardMap.entries()) {
      const shardHealth = worstShardHealth(shardNodes, replicas)
      const shardColor = healthColor[shardHealth]
      const shardNodeId = `shard-${clusterName}-${shardNum}`
      const shardHeight = shardNodes.length * REPLICA_HEIGHT + SHARD_INNER_Y + 12

      // active/total replicas from any replica row
      let activeReplicas = 0, totalReplicas = shardNodes.length
      for (const n of shardNodes) {
        const rs = nodeReplicas(n, replicas)
        if (rs.length > 0) { activeReplicas = rs[0].active_replicas; totalReplicas = rs[0].total_replicas; break }
      }
      const weight = shardNodes[0]?.shard_weight ?? 1
      const hasQueue = shardNodes.some(n => nodeReplicas(n, replicas).some(r => r.queue_size > 0))

      nodes.push({
        id: shardNodeId,
        type: 'default',
        position: { x: shardX, y: oy + SHARD_TOP_OFFSET },
        data: {
          label: (
            <div style={{ width: '100%' }} className="text-center">
              <div style={{ color: shardColor, fontSize: 11, fontWeight: 700 }}>Shard {shardNum}</div>
              <div style={{ color: '#64748b', fontSize: 10, marginTop: 2 }}>
                {activeReplicas}/{totalReplicas} active
                {weight !== 1 && <span style={{ marginLeft: 4 }}>· w:{weight}</span>}
              </div>
              {hasQueue && (
                <div style={{ color: '#f59e0b', fontSize: 9, marginTop: 2 }}>● replicating</div>
              )}
            </div>
          ),
        },
        style: {
          width: SHARD_WIDTH,
          height: shardHeight,
          background: 'rgba(42,45,62,0.6)',
          border: `1px solid ${shardColor}44`,
          borderRadius: 10,
          fontSize: 11,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          paddingTop: 10,
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      })

      edges.push({
        id: `e-${clusterNodeId}-${shardNodeId}`,
        source: clusterNodeId,
        target: shardNodeId,
        animated: clusterHasQueue,
        style: {
          stroke: isSys ? 'rgba(148,163,184,0.2)' : 'rgba(255,204,0,0.2)',
          strokeWidth: 1,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isSys ? 'rgba(148,163,184,0.3)' : 'rgba(255,204,0,0.3)',
        },
      })

      // ── Replica nodes ──────────────────────────────────────────────────────
      shardNodes.forEach((node, i) => {
        const health = replicaHealth(node, replicas)
        const color = healthColor[health]
        const bg = healthBg[health]
        const rs = nodeReplicas(node, replicas)

        const isLeader       = rs.some(r => r.is_leader === 1)
        const isReadonly     = rs.some(r => r.is_readonly === 1)
        const isExpired      = rs.some(r => r.is_session_expired === 1)
        const maxDelay       = rs.reduce((m, r) => Math.max(m, r.absolute_delay), 0)
        const totalQueue     = rs.reduce((s, r) => s + r.queue_size, 0)

        const replicaNodeId = `replica-${clusterName}-${shardNum}-${node.replica_num}`
        nodeToCluster.set(replicaNodeId, node)
        nodes.push({
          id: replicaNodeId,
          type: 'default',
          position: { x: 20, y: SHARD_INNER_Y + i * REPLICA_HEIGHT },
          parentNode: shardNodeId,
          extent: 'parent',
          data: {
            label: (
              <div style={{ position: 'relative', width: '100%', height: '100%', padding: '7px 8px', fontSize: 10 }}>
                {/* Row 1: health dot + hostname + leader + LOCAL */}
                <div className="flex items-center gap-1 mb-1" style={{ paddingRight: 18 }}>
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                  <span className="font-semibold truncate flex-1" style={{ color: '#f1f5f9', fontSize: 11 }}
                    title={node.host_name}>
                    {node.host_name}
                  </span>
                  {isLeader && (
                    <span title="Replication leader" style={{ fontSize: 11, lineHeight: 1 }}>👑</span>
                  )}
                  {node.is_local === 1 && (
                    <span style={{
                      fontSize: 8, background: 'rgba(14,165,233,0.15)',
                      color: '#38bdf8', padding: '1px 4px', borderRadius: 3,
                    }}>LOCAL</span>
                  )}
                </div>

                {/* Row 2: IP:port + replica # */}
                <div style={{ color: '#64748b' }} className="mb-1">
                  {node.host_address}:{node.port} · #{node.replica_num}
                  {node.errors_count > 0 && (
                    <span style={{ color: '#ef4444', marginLeft: 4 }}>{node.errors_count} err</span>
                  )}
                </div>

                {/* Row 3: delay + queue */}
                <div className="flex items-center gap-2">
                  {maxDelay > 0 && (
                    <span style={{
                      color: maxDelay > 300 ? '#ef4444' : maxDelay > 60 ? '#f59e0b' : '#94a3b8',
                    }}>
                      ⏱ {maxDelay}s lag
                    </span>
                  )}
                  {totalQueue > 0 && (
                    <span style={{ color: '#f59e0b' }}>↻ {totalQueue} queued</span>
                  )}
                </div>

                {/* Row 4: status badges */}
                {(isReadonly || isExpired) && (
                  <div className="flex gap-1 mt-1">
                    {isReadonly && (
                      <span style={{
                        fontSize: 8, background: 'rgba(239,68,68,0.12)',
                        color: '#ef4444', padding: '1px 4px', borderRadius: 3,
                        border: '1px solid rgba(239,68,68,0.25)',
                      }}>READONLY</span>
                    )}
                    {isExpired && (
                      <span style={{
                        fontSize: 8, background: 'rgba(245,158,11,0.12)',
                        color: '#f59e0b', padding: '1px 4px', borderRadius: 3,
                        border: '1px solid rgba(245,158,11,0.25)',
                      }}>ZK EXPIRED</span>
                    )}
                  </div>
                )}
              </div>
            ),
          },
          style: {
            width: 200,
            height: 110,
            background: bg,
            border: `1px solid ${color}44`,
            borderRadius: 8,
            fontSize: 10,
            padding: 0,
          },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
        })

        if (i > 0) {
          const prevId = `replica-${clusterName}-${shardNum}-${shardNodes[i - 1].replica_num}`
          edges.push({
            id: `e-${prevId}-${replicaNodeId}`,
            source: prevId,
            target: replicaNodeId,
            style: { stroke: 'rgba(100,116,139,0.3)', strokeWidth: 1, strokeDasharray: '4 2' },
          })
        }
      })

      shardX += SHARD_GAP
    }

    rowX += width + CLUSTER_GAP_X
    maxX = Math.max(maxX, rowX)
    col++
  }

  if (rowIndex < 2) twoRowsBottomY = rowY + rowHeight

  return { nodes, edges, twoRowBounds: { x: 0, y: 0, width: maxX, height: twoRowsBottomY }, nodeToCluster }
}

// ─── Parse Distributed engine_full ───────────────────────────────────────────

function parseDistributedEngine(engineFull: string) {
  const m = engineFull.match(/Distributed\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'(?:\s*,\s*(.+?))?\s*\)/)
  if (!m) return null
  return { cluster: m[1], targetDb: m[2], targetTable: m[3], shardKey: m[4]?.trim() ?? null }
}

// ─── Node drill-down panel ────────────────────────────────────────────────────

function NodeDrillDownPanel({
  node,
  replicas,
  onClose,
}: {
  node: ClusterNode
  replicas: ReplicaInfo[]
  onClose: () => void
}) {
  const nodeReplicas = replicas.filter(r => r.replica_name === node.host_name)

  return (
    <div className="absolute right-0 top-0 h-full w-80 bg-ch-surface border-l border-ch-border shadow-2xl z-50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-ch-border flex-shrink-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
            node.errors_count > 5 ? 'bg-red-500' : node.estimated_recovery_time > 0 ? 'bg-yellow-500' : 'bg-green-500'
          }`} />
          <span className="text-sm font-semibold text-ch-text truncate">{node.host_name}</span>
        </div>
        <button onClick={onClose} className="text-ch-muted hover:text-ch-text transition-colors p-1 rounded hover:bg-ch-bg flex-shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Host info grid */}
        <section>
          <h3 className="text-[10px] font-semibold text-ch-muted uppercase tracking-wider mb-2">Host info</h3>
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { label: 'Address',  value: `${node.host_address}:${node.port}` },
              { label: 'Cluster',  value: node.cluster },
              { label: 'Shard',    value: `#${node.shard_num}` },
              { label: 'Replica',  value: `#${node.replica_num}` },
            ].map(item => (
              <div key={item.label} className="bg-ch-bg rounded-lg px-2.5 py-2">
                <div className="text-[9px] text-ch-muted uppercase tracking-wider">{item.label}</div>
                <div className="text-xs text-ch-text font-mono mt-0.5 truncate" title={item.value}>{item.value}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {node.is_local === 1 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border bg-blue-500/10 text-blue-400 border-blue-500/20">LOCAL</span>
            )}
            {node.errors_count > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border bg-red-500/10 text-red-400 border-red-500/20">
                {node.errors_count} errors
              </span>
            )}
            {node.slowdowns_count > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border bg-yellow-500/10 text-yellow-400 border-yellow-500/20">
                {node.slowdowns_count} slowdowns
              </span>
            )}
            {node.estimated_recovery_time > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border bg-orange-500/10 text-orange-400 border-orange-500/20">
                recovering ~{node.estimated_recovery_time}s
              </span>
            )}
          </div>
        </section>

        {/* Replicated tables on this node */}
        <section>
          <h3 className="text-[10px] font-semibold text-ch-muted uppercase tracking-wider mb-2">
            Replicated tables ({nodeReplicas.length})
          </h3>
          {nodeReplicas.length === 0 ? (
            <p className="text-xs text-ch-muted">No replicated tables found for this host.</p>
          ) : (
            <div className="space-y-1.5">
              {nodeReplicas.map(r => {
                const isHealthy = !r.is_readonly && !r.is_session_expired && r.absolute_delay < 60
                return (
                  <div
                    key={`${r.database}.${r.table}`}
                    className={`bg-ch-bg rounded-lg px-3 py-2 border ${
                      r.is_readonly || r.is_session_expired ? 'border-red-500/30' :
                      r.absolute_delay > 300 ? 'border-yellow-500/30' : 'border-ch-border/50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isHealthy ? 'bg-green-500' : 'bg-yellow-500'}`} />
                      <span className="text-[11px] font-semibold text-ch-text truncate">
                        <span className="text-ch-muted font-normal">{r.database}.</span>{r.table}
                      </span>
                      {r.is_leader === 1 && <span title="Leader" className="text-[10px] ml-auto">👑</span>}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-ch-muted">
                      {r.queue_size > 0 && (
                        <span className="text-yellow-400">q:{r.queue_size}</span>
                      )}
                      {r.absolute_delay > 0 && (
                        <span className={r.absolute_delay > 300 ? 'text-red-400' : r.absolute_delay > 60 ? 'text-yellow-400' : ''}>
                          lag:{r.absolute_delay}s
                        </span>
                      )}
                      <span>{r.active_replicas}/{r.total_replicas} active</span>
                      {r.is_readonly === 1 && <span className="text-red-400">READONLY</span>}
                      {r.is_session_expired === 1 && <span className="text-orange-400">ZK EXPIRED</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>

      <div className="px-4 py-2 border-t border-ch-border text-[9px] text-ch-muted flex-shrink-0">
        Data from last cluster poll · 30s interval
      </div>
    </div>
  )
}

// ─── Routing overlay panel ────────────────────────────────────────────────────

function RoutingPanel({
  table,
  clusters,
  config,
  onClose,
}: {
  table: DistributedTable
  clusters: ClusterNode[]
  config: ConnectionConfig
  onClose: () => void
}) {
  const parsed = useMemo(() => parseDistributedEngine(table.engine_full), [table.engine_full])
  const [loadSizes, setLoadSizes] = useState(false)

  const { data: sizesData, isLoading: sizesLoading } = useQuery({
    queryKey: ['parts_summary', config],
    queryFn: () => fetchPartsSummary(config),
    enabled: loadSizes,
    staleTime: 60_000,
  })

  if (!parsed) return null

  const clusterShards = useMemo(() => {
    const shardMap = new Map<number, ClusterNode[]>()
    for (const c of clusters) {
      if (c.cluster !== parsed.cluster) continue
      if (!shardMap.has(c.shard_num)) shardMap.set(c.shard_num, [])
      shardMap.get(c.shard_num)!.push(c)
    }
    return [...shardMap.entries()].sort((a, b) => a[0] - b[0])
  }, [clusters, parsed.cluster])

  const totalWeight = clusterShards.reduce((s, [, nodes]) => s + (nodes[0]?.shard_weight ?? 1), 0)

  const tableSizes = useMemo(() => {
    if (!sizesData) return null
    return sizesData.find(s =>
      s.database === parsed.targetDb && s.table === parsed.targetTable
    )
  }, [sizesData, parsed])

  return (
    <div className="absolute right-0 top-0 h-full w-80 bg-ch-surface border-l border-ch-border shadow-2xl z-50 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-ch-border flex-shrink-0">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-ch-text truncate">{table.database}.{table.name}</div>
          <div className="text-[10px] text-ch-muted">Routing overlay</div>
        </div>
        <button onClick={onClose} className="text-ch-muted hover:text-ch-text transition-colors p-1 rounded hover:bg-ch-bg">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Table info */}
        <section>
          <div className="space-y-1.5 text-xs">
            <div className="flex gap-2"><span className="text-ch-muted w-20 flex-shrink-0">Cluster</span><span className="text-ch-accent font-mono">{parsed.cluster}</span></div>
            <div className="flex gap-2"><span className="text-ch-muted w-20 flex-shrink-0">Target</span><span className="text-ch-text font-mono">{parsed.targetDb}.{parsed.targetTable}</span></div>
            {parsed.shardKey && (
              <div className="flex gap-2"><span className="text-ch-muted w-20 flex-shrink-0">Shard key</span><span className="text-ch-text font-mono">{parsed.shardKey}</span></div>
            )}
          </div>
        </section>

        {/* Shard routing weights */}
        <section>
          <h3 className="text-[10px] font-semibold text-ch-muted uppercase tracking-wider mb-2">
            Shard routing weights
          </h3>
          <div className="space-y-2">
            {clusterShards.map(([shardNum, nodes]) => {
              const weight    = nodes[0]?.shard_weight ?? 1
              const pct       = totalWeight > 0 ? (weight / totalWeight) * 100 : 0
              const hostNames = nodes.map(n => n.host_name).join(', ')
              return (
                <div key={shardNum}>
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="text-ch-text font-semibold">Shard {shardNum}</span>
                    <span className="text-ch-muted font-mono">{pct.toFixed(0)}% (w:{weight})</span>
                  </div>
                  <div className="w-full h-2 bg-ch-bg rounded overflow-hidden">
                    <div className="h-full bg-ch-accent/60 rounded" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="text-[9px] text-ch-muted mt-0.5 truncate">{hostNames}</div>
                </div>
              )
            })}
          </div>
          <p className="text-[9px] text-ch-muted mt-2">
            Weights from system.clusters — reflects configured routing probability.
          </p>
        </section>

        {/* Local data sizes (opt-in) */}
        <section>
          <h3 className="text-[10px] font-semibold text-ch-muted uppercase tracking-wider mb-2">
            Data on connected node
          </h3>
          {!loadSizes ? (
            <div>
              <button
                onClick={() => setLoadSizes(true)}
                className="flex items-center gap-1.5 text-xs text-ch-accent border border-ch-accent/30 rounded-lg px-2.5 py-1.5 hover:bg-ch-accent/10 transition-colors"
              >
                <ExternalLink className="w-3 h-3" /> Load local sizes
              </button>
              <p className="text-[9px] text-ch-muted mt-1">
                Queries system.parts on this node only.
              </p>
            </div>
          ) : sizesLoading ? (
            <div className="text-xs text-ch-muted animate-pulse">Loading…</div>
          ) : tableSizes ? (
            <div className="space-y-1 text-xs">
              <div className="flex gap-2"><span className="text-ch-muted w-24">Compressed</span><span className="text-ch-text">{fmtBytes(safeNum(tableSizes.total_bytes))}</span></div>
              <div className="flex gap-2"><span className="text-ch-muted w-24">Uncompressed</span><span className="text-ch-text">{fmtBytes(safeNum(tableSizes.total_uncompressed))}</span></div>
              <div className="flex gap-2"><span className="text-ch-muted w-24">Rows</span><span className="text-ch-text">{fmtRows(safeNum(tableSizes.total_rows))}</span></div>
              <div className="flex gap-2"><span className="text-ch-muted w-24">Parts</span><span className="text-ch-text">{safeNum(tableSizes.part_count)}</span></div>
              <p className="text-[9px] text-ch-muted mt-1">Local shard data only. Use Parts tab for full cluster view.</p>
            </div>
          ) : (
            <p className="text-xs text-ch-muted">
              No local parts found for {parsed.targetDb}.{parsed.targetTable}.
            </p>
          )}
        </section>
      </div>
    </div>
  )
}

// ─── Cluster filter dropdown ─────────────────────────────────────────────────

function ClusterFilterDropdown({
  allClusters,
  selected,
  onChange,
}: {
  allClusters: string[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as HTMLElement)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  const filtered = search
    ? allClusters.filter(c => c.toLowerCase().includes(search.toLowerCase()))
    : allClusters

  const allSelected = selected.size === allClusters.length
  const noneSelected = selected.size === 0

  function toggle(name: string) {
    const next = new Set(selected)
    next.has(name) ? next.delete(name) : next.add(name)
    onChange(next)
  }

  const label = allSelected ? 'All clusters'
    : noneSelected ? 'No clusters'
    : `${selected.size} of ${allClusters.length} clusters`

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-2 text-xs border rounded-lg px-3 py-1.5 transition-colors ${
          allSelected
            ? 'bg-ch-bg border-ch-border text-ch-muted hover:border-ch-accent/40 hover:text-ch-text'
            : 'bg-ch-accent/10 border-ch-accent/40 text-ch-accent'
        }`}
      >
        <span>{label}</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-50 w-72 bg-ch-surface border border-ch-border rounded-xl shadow-2xl overflow-hidden">
          <div className="p-2 border-b border-ch-border">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ch-muted pointer-events-none" />
              <input
                autoFocus
                type="text"
                placeholder="Search clusters…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-ch-bg border border-ch-border rounded-lg pl-8 pr-7 py-1.5 text-xs text-ch-text placeholder:text-ch-muted focus:outline-none focus:border-ch-accent/60"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-ch-muted hover:text-ch-text">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-ch-border">
            <button onClick={() => onChange(new Set(allClusters))} disabled={allSelected}
              className="text-xs text-ch-accent hover:text-ch-accent/80 disabled:opacity-40 disabled:cursor-default px-1">
              Select all
            </button>
            <span className="text-ch-border">|</span>
            <button onClick={() => onChange(new Set())} disabled={noneSelected}
              className="text-xs text-ch-muted hover:text-ch-text disabled:opacity-40 disabled:cursor-default px-1">
              Clear
            </button>
            <span className="ml-auto text-xs text-ch-muted">{selected.size} selected</span>
          </div>

          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-ch-muted">No clusters match</div>
            ) : (
              filtered.map(name => {
                const checked = selected.has(name)
                const sys = isSystemCluster(name)
                return (
                  <button key={name} onClick={() => toggle(name)}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-ch-bg transition-colors text-left">
                    <div className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border transition-colors ${
                      checked ? 'bg-ch-accent border-ch-accent' : 'border-ch-border'
                    }`}>
                      {checked && <Check className="w-2.5 h-2.5 text-ch-bg" strokeWidth={3} />}
                    </div>
                    <span className="text-xs text-ch-text truncate font-mono flex-1">{name}</span>
                    {sys && (
                      <span className="text-[9px] text-ch-muted border border-ch-border rounded px-1 flex-shrink-0">sys</span>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ClusterTopology({ clusters, replicas, tables = [], config }: Props) {
  const allClusterNames = useMemo(
    () => [...new Set(clusters.map(c => c.cluster))].sort(),
    [clusters]
  )

  const [selected, setSelected]               = useState<Set<string>>(() => new Set(allClusterNames))
  const [zoomOnScroll, setZoomOnScroll]        = useState(true)
  const [selectedNode, setSelectedNode]        = useState<ClusterNode | null>(null)
  const [selectedDistTable, setSelectedDistTable] = useState<DistributedTable | null>(null)
  const rfInstance = useRef<ReactFlowInstance | null>(null)

  useEffect(() => {
    setSelected(prev => {
      const next = new Set([...prev].filter(n => allClusterNames.includes(n)))
      if (next.size === 0 && allClusterNames.length > 0) return new Set(allClusterNames)
      return next
    })
  }, [allClusterNames])

  const filteredClusters = useMemo(
    () => clusters.filter(c => selected.has(c.cluster)),
    [clusters, selected]
  )

  const { nodes: baseNodes, edges: baseEdges, twoRowBounds, nodeToCluster } = useMemo(
    () => buildGraph(filteredClusters, replicas),
    [filteredClusters, replicas]
  )

  // Routing overlay edges when a Distributed table is selected
  const { nodes, edges } = useMemo(() => {
    if (!selectedDistTable) return { nodes: baseNodes, edges: baseEdges }
    const parsed = parseDistributedEngine(selectedDistTable.engine_full)
    if (!parsed) return { nodes: baseNodes, edges: baseEdges }

    const clusterNodeId = `cluster-${parsed.cluster}`
    const shardNums = [...new Set(
      filteredClusters.filter(c => c.cluster === parsed.cluster).map(c => c.shard_num)
    )]

    const overlayEdges: Edge[] = shardNums.map(shardNum => ({
      id: `routing-${parsed.cluster}-${shardNum}`,
      source: clusterNodeId,
      target: `shard-${parsed.cluster}-${shardNum}`,
      animated: true,
      style: { stroke: '#ffcc00', strokeWidth: 2, strokeDasharray: '6 3' },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#ffcc00' },
      zIndex: 10,
    }))

    return { nodes: baseNodes, edges: [...baseEdges, ...overlayEdges] }
  }, [baseNodes, baseEdges, selectedDistTable, filteredClusters])

  const fitTwoRows = () => {
    if (!rfInstance.current) return
    if (twoRowBounds.width > 0 && twoRowBounds.height > 0) {
      rfInstance.current.fitBounds(twoRowBounds, { padding: 0.1, duration: 300 })
    } else {
      rfInstance.current.fitView({ padding: 0.15, duration: 300 })
    }
  }

  useEffect(() => {
    fitTwoRows()
    window.addEventListener('resize', fitTwoRows)
    return () => window.removeEventListener('resize', fitTwoRows)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, twoRowBounds])

  const distTables = useMemo(
    () => tables.filter(t => t.engine === 'Distributed'),
    [tables]
  )

  if (clusters.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-ch-muted">
        No cluster data found in system.clusters
      </div>
    )
  }

  // Right panel: drill-down takes priority over routing
  const showDrillDown = !!selectedNode
  const showRouting   = !showDrillDown && !!selectedDistTable && !!config

  return (
    <div className="w-full h-full relative">
      {selected.size === 0 ? (
        <div className="w-full h-full flex flex-col items-center justify-center gap-4">
          <span className="text-ch-muted text-sm">No clusters selected</span>
          <ClusterFilterDropdown
            allClusters={allClusterNames}
            selected={selected}
            onChange={setSelected}
          />
        </div>
      ) : (
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.05}
          maxZoom={2}
          zoomOnScroll={zoomOnScroll}
          panOnScroll={!zoomOnScroll}
          proOptions={{ hideAttribution: true }}
          onInit={instance => {
            rfInstance.current = instance
            setTimeout(() => fitTwoRows(), 50)
          }}
          onNodeClick={(_, node) => {
            if (node.id.startsWith('replica-')) {
              const clusterNode = nodeToCluster.get(node.id)
              if (clusterNode) {
                setSelectedNode(prev => prev?.host_name === clusterNode.host_name && prev?.shard_num === clusterNode.shard_num ? null : clusterNode)
              }
            }
          }}
          onPaneClick={() => setSelectedNode(null)}
        >
          <Background color="#2a2d3e" gap={24} />
          <Controls
            className="!bg-ch-surface !border-ch-border"
            onInteractiveChange={interactive => setZoomOnScroll(interactive)}
          />
          <MiniMap
            nodeColor={n => {
              if (n.id.startsWith('cluster-')) return 'rgba(255,204,0,0.3)'
              if (n.id.startsWith('shard-')) return 'rgba(42,45,62,0.8)'
              return '#22c55e'
            }}
            style={{ background: '#1a1d27', border: '1px solid #2a2d3e' }}
          />

          {/* ── Top-left: cluster filter ── */}
          <Panel position="top-left">
            <div className="flex items-center gap-2 bg-ch-surface/90 backdrop-blur border border-ch-border rounded-xl px-3 py-2 shadow-lg">
              <ClusterFilterDropdown
                allClusters={allClusterNames}
                selected={selected}
                onChange={setSelected}
              />
              {selected.size < allClusterNames.length && (
                <span className="text-xs text-ch-muted">
                  <span className="text-ch-text font-semibold">{selected.size}</span>
                  <span className="text-ch-muted">/{allClusterNames.length}</span>
                </span>
              )}
            </div>
          </Panel>

          {/* ── Top-right: legend ── */}
          <Panel position="top-right">
            <div className="flex items-center gap-3 bg-ch-surface/90 backdrop-blur border border-ch-border rounded-xl px-3 py-2 shadow-lg text-xs text-ch-muted">
              {Object.entries(healthColor).map(([k, c]) => (
                <span key={k} className="flex items-center gap-1.5 capitalize">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c }} />
                  {k}
                </span>
              ))}
              <span className="flex items-center gap-1.5 pl-2 border-l border-ch-border">
                <span>👑</span> leader
              </span>
              <span className="flex items-center gap-1.5 pl-2 border-l border-ch-border">
                <span className="w-2 h-2 rounded-sm flex-shrink-0"
                  style={{ background: 'rgba(148,163,184,0.15)', border: '1px solid rgba(148,163,184,0.3)' }} />
                system
              </span>
            </div>
          </Panel>

          {/* ── Bottom-left: routing table selector ── */}
          {distTables.length > 0 && (
            <Panel position="bottom-left">
              <div className="bg-ch-surface/90 backdrop-blur border border-ch-border rounded-xl px-3 py-2 shadow-lg">
                <select
                  value={selectedDistTable ? `${selectedDistTable.database}.${selectedDistTable.name}` : ''}
                  onChange={e => {
                    const val = e.target.value
                    if (!val) { setSelectedDistTable(null); return }
                    const [db, name] = val.split('.')
                    setSelectedDistTable(distTables.find(t => t.database === db && t.name === name) ?? null)
                  }}
                  className="bg-ch-bg border border-ch-border rounded-lg px-2.5 py-1.5 text-xs text-ch-text focus:outline-none focus:border-ch-accent/60 max-w-56"
                >
                  <option value="">Routing overlay: select table…</option>
                  {distTables.map(t => (
                    <option key={`${t.database}.${t.name}`} value={`${t.database}.${t.name}`}>
                      {t.database}.{t.name}
                    </option>
                  ))}
                </select>
              </div>
            </Panel>
          )}
        </ReactFlow>
      )}

      {/* ── Node drill-down panel ── */}
      {showDrillDown && (
        <NodeDrillDownPanel
          node={selectedNode!}
          replicas={replicas}
          onClose={() => setSelectedNode(null)}
        />
      )}

      {/* ── Routing info panel ── */}
      {showRouting && (
        <RoutingPanel
          table={selectedDistTable!}
          clusters={filteredClusters}
          config={config!}
          onClose={() => setSelectedDistTable(null)}
        />
      )}
    </div>
  )
}
