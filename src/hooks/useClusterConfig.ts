import { useQuery } from '@tanstack/react-query'
import {
  fetchServerSettings,
  fetchSettings,
  fetchMergeTreeSettings,
} from '../api/clickhouse'
import type { ConnectionConfig } from '../types'

const REFETCH_INTERVAL = 60_000

export function useClusterConfig(config: ConnectionConfig | null, clusterName: string | null) {
  const enabled = !!config

  const serverSettings = useQuery({
    queryKey: ['config-server-settings', config, clusterName],
    queryFn: () => fetchServerSettings(config!, clusterName),
    enabled,
    refetchInterval: (q) => (q.state.status === 'error' ? false : REFETCH_INTERVAL),
    staleTime: 55_000,
  })

  const settings = useQuery({
    queryKey: ['config-settings', config, clusterName],
    queryFn: () => fetchSettings(config!, clusterName),
    enabled,
    refetchInterval: (q) => (q.state.status === 'error' ? false : REFETCH_INTERVAL),
    staleTime: 55_000,
  })

  const mergeTreeSettings = useQuery({
    queryKey: ['config-merge-tree-settings', config, clusterName],
    queryFn: () => fetchMergeTreeSettings(config!, clusterName),
    enabled,
    refetchInterval: (q) => (q.state.status === 'error' ? false : REFETCH_INTERVAL),
    staleTime: 55_000,
  })

  const isLoading = serverSettings.isLoading || settings.isLoading || mergeTreeSettings.isLoading

  return {
    serverSettings: serverSettings.data ?? [],
    settings: settings.data ?? [],
    mergeTreeSettings: mergeTreeSettings.data ?? [],
    isLoading,
    error: (serverSettings.error || settings.error) as Error | null,
  }
}
