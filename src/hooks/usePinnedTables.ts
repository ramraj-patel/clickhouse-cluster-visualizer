import { useState, useCallback } from 'react'

function load(storageKey: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey)
    return new Set(raw ? JSON.parse(raw) : [])
  } catch {
    return new Set()
  }
}

function save(storageKey: string, keys: Set<string>) {
  localStorage.setItem(storageKey, JSON.stringify([...keys]))
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
