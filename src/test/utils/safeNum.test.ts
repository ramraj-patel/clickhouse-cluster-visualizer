import { describe, it, expect } from 'vitest'
import { safeNum } from '../../api/clickhouse'

describe('safeNum', () => {
  it('passes through a number', () => {
    expect(safeNum(42)).toBe(42)
  })
  it('coerces a string number', () => {
    expect(safeNum('123')).toBe(123)
  })
  it('coerces ClickHouse UInt64 string', () => {
    expect(safeNum('9007199254740992')).toBe(9007199254740992)
  })
  it('returns 0 for undefined', () => {
    expect(safeNum(undefined)).toBe(0)
  })
  it('returns 0 for null', () => {
    expect(safeNum(null)).toBe(0)
  })
  it('returns 0 for empty string', () => {
    expect(safeNum('')).toBe(0)
  })
  it('returns 0 for non-numeric string', () => {
    expect(safeNum('abc')).toBe(0)
  })
  it('returns 0 for NaN', () => {
    expect(safeNum(NaN)).toBe(0)
  })
  it('returns 0 for Infinity', () => {
    expect(safeNum(Infinity)).toBe(0)
  })
})
