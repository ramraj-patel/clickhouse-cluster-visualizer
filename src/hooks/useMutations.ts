import { useQuery } from '@tanstack/react-query'
import { fetchMutations } from '../api/clickhouse'
import type { ConnectionConfig } from '../types'

export function useMutations(config: ConnectionConfig | null) {
  return useQuery({
    queryKey: ['mutations', config],
    queryFn: () => fetchMutations(config!),
    enabled: !!config,
    refetchInterval: 30_000,
    staleTime: 15_000,
  })
}
