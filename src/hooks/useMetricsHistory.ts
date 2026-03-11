import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchMetrics, fetchEvents, fetchAsyncMetrics } from '../api/clickhouse'
import type { ConnectionConfig } from '../types'

const POLL_INTERVAL = 15_000  // 15 seconds
const MAX_HISTORY   = 40      // ~10 minutes of history

export interface MetricSnapshot {
  ts: number
  metrics:  Record<string, number>
  events:   Record<string, number>  // raw cumulative
  async:    Record<string, number>
}

export type MetricSource = 'metrics' | 'events_rate' | 'async'

export function useMetricsHistory(config: ConnectionConfig | null, paused = false) {
  const [history, setHistory] = useState<MetricSnapshot[]>([])

  const addSnapshot = useCallback((snap: MetricSnapshot) => {
    setHistory(prev => [...prev.slice(-(MAX_HISTORY - 1)), snap])
  }, [])

  const { isFetching } = useQuery({
    queryKey: ['metrics_history', config],
    queryFn: async () => {
      const [metrics, events, asyncMetrics] = await Promise.all([
        fetchMetrics(config!),
        fetchEvents(config!),
        fetchAsyncMetrics(config!),
      ])
      const snap: MetricSnapshot = {
        ts:      Date.now(),
        metrics: Object.fromEntries(metrics.map(m => [m.metric, m.value])),
        events:  Object.fromEntries(events.map(e => [e.event, e.value])),
        async:   Object.fromEntries(asyncMetrics.map(a => [a.metric, a.value])),
      }
      addSnapshot(snap)
      return snap
    },
    enabled: !!config && !paused,
    refetchInterval: paused ? false : POLL_INTERVAL,
    staleTime: POLL_INTERVAL - 1000,
  })

  // Get raw history array for a gauge or async metric
  const safe = (v: unknown): number => { const n = Number(v); return isFinite(n) ? n : 0 }

  const getHistory = useCallback((key: string, source: 'metrics' | 'async'): number[] => {
    return history.map(s => safe(s[source][key]))
  }, [history])

  // Get per-second rate history derived from cumulative event counters
  const getRateHistory = useCallback((key: string): number[] => {
    if (history.length < 2) return []
    const rates: number[] = []
    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1]
      const curr = history[i]
      const dt   = (curr.ts - prev.ts) / 1000
      const delta = safe(curr.events[key]) - safe(prev.events[key])
      rates.push(Math.max(0, delta / dt))
    }
    return rates
  }, [history])

  const latest = history[history.length - 1]

  const getValue = useCallback((key: string, source: MetricSource): number => {
    const safe = (v: unknown): number => {
      const n = Number(v)
      return isFinite(n) ? n : 0
    }
    if (!latest) return 0
    if (source === 'metrics') return safe(latest.metrics[key])
    if (source === 'async')   return safe(latest.async[key])
    // events_rate: use last two snapshots
    if (history.length < 2) return 0
    const prev = history[history.length - 2]
    const dt   = (latest.ts - prev.ts) / 1000
    return Math.max(0, (safe(latest.events[key]) - safe(prev.events[key])) / dt)
  }, [latest, history])

  const getSeriesData = useCallback((key: string, source: MetricSource): number[] => {
    if (source === 'events_rate') return getRateHistory(key)
    return getHistory(key, source as 'metrics' | 'async')
  }, [getHistory, getRateHistory])

  return {
    history,
    isFetching,
    getValue,
    getSeriesData,
    pollInterval: POLL_INTERVAL,
  }
}
