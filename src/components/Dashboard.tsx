import { useState, useMemo } from 'react'
import { RefreshCw, LogOut, Activity, Database, GitBranch, TreePine, BarChart3, AlertCircle, ChevronDown, BookOpen, HelpCircle } from 'lucide-react'
import { useClusterData } from '../hooks/useClusterData'
import { ClusterTopology } from './ClusterTopology'
import { DistributedTables } from './DistributedTables'
import { ReplicationStatus } from './ReplicationStatus'
import { ZookeeperNodes } from './ZookeeperNodes'
import { MetricsPanel } from './MetricsPanel'
import { QueryDocs } from './QueryDocs'
import { HelpDrawer } from './HelpDrawer'
import type { ConnectionConfig, ActiveTab } from '../types'

interface Props {
  config: ConnectionConfig
  version: string
  onDisconnect: () => void
}

const TABS: { id: ActiveTab; label: string; icon: React.ReactNode }[] = [
  { id: 'topology', label: 'Topology', icon: <GitBranch className="w-4 h-4" /> },
  { id: 'tables', label: 'Tables', icon: <Database className="w-4 h-4" /> },
  { id: 'replication', label: 'Replication', icon: <Activity className="w-4 h-4" /> },
  { id: 'zookeeper', label: 'ZooKeeper', icon: <TreePine className="w-4 h-4" /> },
  { id: 'metrics', label: 'Metrics', icon: <BarChart3 className="w-4 h-4" /> },
  { id: 'docs', label: 'Query Docs', icon: <BookOpen className="w-4 h-4" /> },
]

export function Dashboard({ config, version, onDisconnect }: Props) {
  const [tab, setTab] = useState<ActiveTab>('topology')
  const [showHelp, setShowHelp] = useState(false)
  const [selectedDb, setSelectedDb] = useState<string>('__all__')
  const { clusters, replicas, tables, replicationQueue, metrics, isLoading, error, refetchAll } =
    useClusterData(config)

  const databases = useMemo(() => {
    const dbs = new Set<string>()
    tables.forEach(t => dbs.add(t.database))
    replicas.forEach(r => dbs.add(r.database))
    return [...dbs].sort()
  }, [tables, replicas])

  const filteredTables = useMemo(
    () => selectedDb === '__all__' ? tables : tables.filter(t => t.database === selectedDb),
    [tables, selectedDb]
  )
  const filteredReplicas = useMemo(
    () => selectedDb === '__all__' ? replicas : replicas.filter(r => r.database === selectedDb),
    [replicas, selectedDb]
  )
  const filteredQueue = useMemo(
    () => selectedDb === '__all__' ? replicationQueue : replicationQueue.filter(q => q.database === selectedDb),
    [replicationQueue, selectedDb]
  )

  // When a database is selected, narrow cluster nodes to hosts that have replicas for that db
  const scopedClusterNodes = useMemo(() => {
    if (selectedDb === '__all__') return clusters
    const hosts = new Set(filteredReplicas.map(r => r.replica_name))
    return clusters.filter(c => hosts.has(c.host_name))
  }, [clusters, filteredReplicas, selectedDb])

  const clusterNames = [...new Set(scopedClusterNodes.map(c => c.cluster))]
  const shardCount = [...new Set(scopedClusterNodes.map(c => `${c.cluster}:${c.shard_num}`))].length
  const replicaCount = scopedClusterNodes.length
  const unhealthy = filteredReplicas.filter(r => r.is_readonly === 1 || r.absolute_delay > 300).length

  return (
    <div className="flex flex-col h-screen bg-ch-bg text-ch-text">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-ch-border bg-ch-surface flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-ch-accent/10 border border-ch-accent/30 flex items-center justify-center text-sm">
            🖱️
          </div>
          <div>
            <span className="font-semibold text-sm text-ch-text">
              {config.host}:{config.port}
            </span>
            <span className="text-xs text-ch-muted ml-2">ClickHouse {version}</span>
          </div>
        </div>

        {/* Stats row */}
        <div className="hidden md:flex items-center gap-6 text-xs">
          <span className="text-ch-muted">
            Clusters: <span className="text-ch-text font-semibold">{clusterNames.length}</span>
          </span>
          <span className="text-ch-muted">
            Shards: <span className="text-ch-text font-semibold">{shardCount}</span>
          </span>
          <span className="text-ch-muted">
            Replicas: <span className="text-ch-text font-semibold">{replicaCount}</span>
          </span>
          {unhealthy > 0 && (
            <span className="flex items-center gap-1 text-red-400">
              <AlertCircle className="w-3.5 h-3.5" />
              {unhealthy} unhealthy
            </span>
          )}
          {replicationQueue.filter(q => q.is_currently_executing).length > 0 && (
            <span className="flex items-center gap-1 text-yellow-400">
              <Activity className="w-3.5 h-3.5" />
              {replicationQueue.filter(q => q.is_currently_executing).length} replicating
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Database selector */}
          <div className="relative">
            <Database className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ch-muted pointer-events-none" />
            <select
              value={selectedDb}
              onChange={e => setSelectedDb(e.target.value)}
              className="appearance-none bg-ch-bg border border-ch-border rounded-lg pl-7 pr-7 py-1.5 text-xs text-ch-text focus:outline-none focus:border-ch-accent/60 transition-colors cursor-pointer"
            >
              <option value="__all__">All databases</option>
              {databases.map(db => (
                <option key={db} value={db}>{db}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-ch-muted pointer-events-none" />
          </div>

          <button
            onClick={refetchAll}
            className="flex items-center gap-1.5 text-xs text-ch-muted hover:text-ch-text border border-ch-border rounded-lg px-3 py-1.5 transition-colors hover:border-ch-accent/30"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={onDisconnect}
            className="flex items-center gap-1.5 text-xs text-ch-muted hover:text-red-400 border border-ch-border rounded-lg px-3 py-1.5 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Disconnect
          </button>
        </div>
      </header>

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-ch-border bg-ch-surface/50 flex-shrink-0">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === t.id
                ? 'bg-ch-accent/10 text-ch-accent border border-ch-accent/20'
                : 'text-ch-muted hover:text-ch-text hover:bg-ch-surface'
            }`}
          >
            {t.icon}
            {t.label}
            {t.id === 'replication' && replicationQueue.filter(q => q.is_currently_executing).length > 0 && (
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 ml-0.5" />
            )}
          </button>
        ))}
        <button
          onClick={() => setShowHelp(v => !v)}
          title="About this view"
          className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            showHelp
              ? 'bg-ch-accent/10 text-ch-accent border border-ch-accent/20'
              : 'text-ch-muted hover:text-ch-text hover:bg-ch-surface'
          }`}
        >
          <HelpCircle className="w-4 h-4" />
          About
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-red-400 text-xs flex-shrink-0">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error.message}
        </div>
      )}

      {/* Help drawer */}
      {showHelp && <HelpDrawer tab={tab} onClose={() => setShowHelp(false)} />}

      {/* Content */}
      <main className="flex-1 overflow-auto relative">
        {tab === 'topology' && (
          <div className="h-full">
            {isLoading ? (
              <div className="flex items-center justify-center h-full text-ch-muted text-sm">
                Loading cluster topology…
              </div>
            ) : (
              <ClusterTopology clusters={clusters} replicas={filteredReplicas} />
            )}
          </div>
        )}
        {tab === 'tables' && <DistributedTables tables={filteredTables} config={config} />}
        {tab === 'replication' && <ReplicationStatus replicas={filteredReplicas} queue={filteredQueue} />}
        {tab === 'zookeeper' && <ZookeeperNodes config={config} replicas={filteredReplicas} />}
        {tab === 'metrics' && <MetricsPanel config={config} />}
        {tab === 'docs' && <QueryDocs />}
      </main>
    </div>
  )
}
