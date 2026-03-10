import { useQuery } from '@tanstack/react-query'
import { fetchProcesses } from '../api/clickhouse'
import type { ConnectionConfig } from '../types'

export function useProcesses(config: ConnectionConfig | null, paused = false) {
  return useQuery({
    queryKey: ['processes', config],
    queryFn: () => fetchProcesses(config!),
    enabled: !!config,
    refetchInterval: paused ? false : 5_000,
    staleTime: 4_000,
  })
}
