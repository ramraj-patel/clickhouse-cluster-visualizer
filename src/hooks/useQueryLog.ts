import { useQuery } from '@tanstack/react-query'
import { fetchQueryLog } from '../api/clickhouse'
import type { ConnectionConfig } from '../types'

export function useQueryLog(
  config: ConnectionConfig | null,
  intervalMinutes: number,
  limit: number,
  excludePatterns: string[] = [],
  databases: string[] = [],
  tables: string[] = [],
  search: string = '',
  autoRefreshMs: number | false = false
) {
  return useQuery({
    queryKey: ['query_log', config, intervalMinutes, limit, excludePatterns, databases, tables, search],
    queryFn: () => fetchQueryLog(config!, intervalMinutes, limit, excludePatterns, databases, tables, search),
    enabled: !!config,
    staleTime: 30_000,
    refetchInterval: autoRefreshMs,
  })
}
