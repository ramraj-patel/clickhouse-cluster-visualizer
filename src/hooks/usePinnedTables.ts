import { useState, useCallback } from 'react'

const STORAGE_VERSION = 1

interface StoredData {
  v: number
  keys: string[]
}

function load(storageKey: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return new Set()

    const parsed: unknown = JSON.parse(raw)

    // Legacy format: bare array (no version envelope) — migrate transparently
    if (Array.isArray(parsed)) {
      const migrated: StoredData = { v: STORAGE_VERSION, keys: parsed as string[] }
      localStorage.setItem(storageKey, JSON.stringify(migrated))
      return new Set(migrated.keys)
    }

    // Versioned format
    if (parsed && typeof parsed === 'object' && 'v' in parsed && 'keys' in parsed) {
      const data = parsed as StoredData
      if (data.v === STORAGE_VERSION && Array.isArray(data.keys)) {
        return new Set(data.keys)
      }
      // Unknown version — clear and start fresh rather than risk stale/corrupt state
      localStorage.removeItem(storageKey)
      return new Set()
    }

    return new Set()
  } catch {
    return new Set()
  }
}

function save(storageKey: string, keys: Set<string>) {
  const data: StoredData = { v: STORAGE_VERSION, keys: [...keys] }
  localStorage.setItem(storageKey, JSON.stringify(data))
}

export function usePinnedTables(storageKey = 'ch-pinned-tables') {
  const [pinned, setPinned] = useState<Set<string>>(() => load(storageKey))

  const toggle = useCallback((key: string) => {
    setPinned(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      save(storageKey, next)
      return next
    })
  }, [storageKey])

  const isPinned = useCallback((key: string) => pinned.has(key), [pinned])

  return { isPinned, toggle }
}
