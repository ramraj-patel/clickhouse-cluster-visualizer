import { useState, useMemo, useEffect, useCallback } from 'react'
import {
  RefreshCw, LogOut, Activity, Database, GitBranch, TreePine,
  BarChart3, AlertCircle, ChevronDown, BookOpen, HelpCircle,
  FileText, HardDrive, Terminal, Wrench, HardDriveDownload, Server, Settings,
} from 'lucide-react'
import { useClusterData } from '../hooks/useClusterData'
import { ClusterTopology } from './ClusterTopology'
import { DistributedTables } from './DistributedTables'
import { ReplicationStatus } from './ReplicationStatus'
import { ZookeeperNodes } from './ZookeeperNodes'
import { HealthDashboard } from './HealthDashboard'
import { QueryDocs } from './QueryDocs'
import { HelpDrawer } from './HelpDrawer'
import { QueryLogViewer } from './QueryLogViewer'
import { PartsInspector } from './PartsInspector'
import { ProcessMonitor } from './ProcessMonitor'
import { MutationsTracker } from './MutationsTracker'
import { HostsPanel } from './HostsPanel'
import { ClusterConfig } from './ClusterConfig'
import { ErrorBoundary } from './ErrorBoundary'
import { useUrlState } from '../hooks/useUrlState'
import { safeNum } from '../api/clickhouse'
import type { ConnectionConfig, ActiveTab } from '../types'

interface Props {
  config: ConnectionConfig
  version: string
  onDisconnect: () => void
}

const TABS: { id: ActiveTab; label: string; icon: React.ReactNode }[] = [
  { id: 'topology',    label: 'Topology',    icon: <GitBranch  className="w-4 h-4" /> },
  { id: 'tables',      label: 'Tables',      icon: <Database   className="w-4 h-4" /> },
  { id: 'replication', label: 'Replication', icon: <Activity   className="w-4 h-4" /> },
  { id: 'zookeeper',   label: 'ZooKeeper',   icon: <TreePine   className="w-4 h-4" /> },
  { id: 'health',      label: 'Health',      icon: <BarChart3  className="w-4 h-4" /> },
  { id: 'query-log',   label: 'Query Log',   icon: <FileText   className="w-4 h-4" /> },
  { id: 'parts',       label: 'Parts',       icon: <HardDrive  className="w-4 h-4" /> },
  { id: 'processes',   label: 'Processes',   icon: <Terminal   className="w-4 h-4" /> },
  { id: 'mutations',   label: 'Mutations',   icon: <Wrench     className="w-4 h-4" /> },
  { id: 'hosts',       label: 'Hosts',       icon: <Server     className="w-4 h-4" /> },
  { id: 'cluster-config', label: 'Config',   icon: <Settings   className="w-4 h-4" /> },
  { id: 'docs',        label: 'Query Docs',  icon: <BookOpen   className="w-4 h-4" /> },
]

const TAB_IDS = TABS.map(t => t.id) as ActiveTab[]

export function Dashboard({ config, version, onDisconnect }: Props) {
  // Tab is persisted in the URL hash (#tab=topology) — survives page refresh and is shareable.
  const [tab, setTab]               = useUrlState<ActiveTab>('tab', 'topology', TAB_IDS)
  const [showHelp, setShowHelp]     = useState(false)
  const [selectedDb, setSelectedDb] = useState<string>('__all__')
  const [queryFilter, setQueryFilter] = useState<string | null>(null)

  const {
    clusters, replicas, tables, replicationQueue,
    disks, serverErrors,
    isLoading, error, refetchAll,
  } = useClusterData(config, tab)

  // Clear query filter when navigating away from query-log tab
  useEffect(() => {
    if (tab !== 'query-log') setQueryFilter(null)
  }, [tab])

  // Keyboard shortcuts: Alt+1–9 switch tabs (Alt+0 for tab 10)
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return
    const n = e.key === '0' ? 10 : parseInt(e.key)
    if (!isNaN(n) && n >= 1 && n <= TABS.length) {
      e.preventDefault()
      setTab(TABS[n - 1].id)
    }
  }, [setTab])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Direction A: Process Monitor → Query Log
  function handleViewInLog(queryId: string) {
    setQueryFilter(queryId)
    setTab('query-log')
  }

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
  const scopedClusterNodes = useMemo(() => {
    if (selectedDb === '__all__') return clusters
    const hosts = new Set(filteredReplicas.map(r => r.replica_name))
    return clusters.filter(c => hosts.has(c.host_name))
  }, [clusters, filteredReplicas, selectedDb])

  // Header stats
  const clusterNames  = [...new Set(scopedClusterNodes.map(c => c.cluster))]
  const shardCount    = [...new Set(scopedClusterNodes.map(c => `${c.cluster}:${c.shard_num}`))].length
  const replicaCount  = scopedClusterNodes.length
  const unhealthy     = filteredReplicas.filter(r => r.is_readonly === 1 || r.absolute_delay > 300).length
  const activeJobs    = replicationQueue.filter(q => q.is_currently_executing).length

  // Disk warning (any disk >85% full)
  const diskWarning = disks.find(d => safeNum(d.used_fraction) > 0.85)
  const diskDanger  = disks.find(d => safeNum(d.used_fraction) > 0.95)

  // Server error count
  const errorCount = serverErrors.reduce((s, e) => s + safeNum(e.value), 0)

  // Mutation badge
  const inFlightMutations = 0 // surfaced in MutationsTracker, no extra fetch here

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
        <div className="hidden md:flex items-center gap-5 text-xs">
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
          {activeJobs > 0 && (
            <span className="flex items-center gap-1 text-yellow-400">
              <Activity className="w-3.5 h-3.5" />
              {activeJobs} replicating
            </span>
          )}
          {(diskDanger ?? diskWarning) && (
            <span
              className={`flex items-center gap-1 cursor-pointer ${diskDanger ? 'text-red-400' : 'text-yellow-400'}`}
              onClick={() => setTab('parts')}
              title={`${(diskDanger ?? diskWarning)!.name}: ${((safeNum((diskDanger ?? diskWarning)!.used_fraction)) * 100).toFixed(0)}% used`}
            >
              <HardDriveDownload className="w-3.5 h-3.5" />
              disk {diskDanger ? 'critical' : 'warning'}
            </span>
          )}
          {errorCount > 0 && (
            <span className="flex items-center gap-1 text-orange-400" title={`${serverErrors.length} error type(s) — ${errorCount} total occurrences`}>
              <AlertCircle className="w-3.5 h-3.5" />
              {serverErrors.length} server error{serverErrors.length !== 1 ? 's' : ''}
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
      <div className="flex items-center gap-1 px-4 py-2 border-b border-ch-border bg-ch-surface/50 flex-shrink-0 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex-shrink-0 ${
              tab === t.id
                ? 'bg-ch-accent/10 text-ch-accent border border-ch-accent/20'
                : 'text-ch-muted hover:text-ch-text hover:bg-ch-surface'
            }`}
          >
            {t.icon}
            {t.label}
            {t.id === 'replication' && activeJobs > 0 && (
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 ml-0.5" />
            )}
          </button>
        ))}
        <button
          onClick={() => setShowHelp(v => !v)}
          title="About this view"
          className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex-shrink-0 ${
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

      {/* Content — each tab is wrapped in its own ErrorBoundary so a crash in one
          tab doesn't kill the others. Boundaries reset automatically when the tab
          unmounts (user navigates away) and remounts. */}
      <main className="flex-1 overflow-auto relative">
        {tab === 'topology' && (
          <ErrorBoundary label="Topology tab">
            <div className="h-full">
              {isLoading ? (
                <div className="flex items-center justify-center h-full text-ch-muted text-sm">
                  Loading cluster topology…
                </div>
              ) : (
                <ClusterTopology
                  clusters={scopedClusterNodes}
                  replicas={filteredReplicas}
                  tables={tables}
                  config={config}
                />
              )}
            </div>
          </ErrorBoundary>
        )}
        {tab === 'tables'      && <ErrorBoundary label="Tables tab"><DistributedTables tables={filteredTables} clusters={clusters} config={config} /></ErrorBoundary>}
        {tab === 'replication' && <ErrorBoundary label="Replication tab"><ReplicationStatus replicas={filteredReplicas} queue={filteredQueue} /></ErrorBoundary>}
        {tab === 'zookeeper'   && <ErrorBoundary label="ZooKeeper tab"><ZookeeperNodes config={config} replicas={filteredReplicas} /></ErrorBoundary>}
        {tab === 'health'      && (
          <ErrorBoundary label="Health tab">
            <HealthDashboard
              config={config}
              clusters={clusters}
              replicas={replicas}
              disks={disks}
              onNavigate={setTab}
            />
          </ErrorBoundary>
        )}
        {tab === 'query-log'   && (
          <ErrorBoundary label="Query Log tab">
            <QueryLogViewer
              config={config}
              filterQueryId={queryFilter}
              onClearFilter={() => setQueryFilter(null)}
            />
          </ErrorBoundary>
        )}
        {tab === 'parts'       && <ErrorBoundary label="Parts tab"><PartsInspector config={config} /></ErrorBoundary>}
        {tab === 'processes'   && (
          <ErrorBoundary label="Processes tab">
            <ProcessMonitor
              config={config}
              onViewInLog={handleViewInLog}
            />
          </ErrorBoundary>
        )}
        {tab === 'mutations'   && <ErrorBoundary label="Mutations tab"><MutationsTracker config={config} /></ErrorBoundary>}
        {tab === 'hosts'       && <ErrorBoundary label="Hosts tab"><HostsPanel clusters={clusters} config={config} /></ErrorBoundary>}
        {tab === 'cluster-config' && <ErrorBoundary label="Config tab"><ClusterConfig config={config} clusters={clusters} /></ErrorBoundary>}
        {tab === 'docs'        && <ErrorBoundary label="Query Docs tab"><QueryDocs /></ErrorBoundary>}
      </main>
    </div>
  )
}
