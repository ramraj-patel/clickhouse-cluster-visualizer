import { useState, useEffect, useCallback } from 'react'

/**
 * Syncs a string state value to a URL hash parameter.
 *
 * URL format: #tab=query-log&db=mydb
 *
 * - On mount: reads the current value from the hash, validates it is in
 *   `validValues`, and falls back to `defaultValue` if not.
 * - Setter: updates both React state and window.location.hash atomically.
 * - Back/forward navigation (popstate) updates state from the new hash.
 *
 * @param param       The URL parameter name (e.g. "tab")
 * @param defaultValue Value used when param is absent or invalid
 * @param validValues  Allowlist; any value not in this list is rejected
 */
export function useUrlState<T extends string>(
  param: string,
  defaultValue: T,
  validValues: readonly T[]
): [T, (v: T) => void] {
  function readFromHash(): T {
    try {
      const hash = window.location.hash.slice(1) // remove leading #
      const params = new URLSearchParams(hash)
      const raw = params.get(param)
      if (raw && (validValues as readonly string[]).includes(raw)) {
        return raw as T
      }
    } catch {
      // malformed hash — ignore
    }
    return defaultValue
  }

  function writeToHash(value: T) {
    try {
      const hash = window.location.hash.slice(1)
      const params = new URLSearchParams(hash)
      params.set(param, value)
      window.location.hash = params.toString()
    } catch {
      // ignore
    }
  }

  const [value, setValue] = useState<T>(readFromHash)

  const set = useCallback((v: T) => {
    setValue(v)
    writeToHash(v)
  }, [param]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep state in sync with browser back/forward navigation
  useEffect(() => {
    function onPopState() {
      setValue(readFromHash())
    }
    window.addEventListener('popstate', onPopState)
    window.addEventListener('hashchange', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
      window.removeEventListener('hashchange', onPopState)
    }
  }, [param, defaultValue]) // eslint-disable-line react-hooks/exhaustive-deps

  return [value, set]
}
