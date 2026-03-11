import { describe, it, expect } from 'vitest'
import { fmtBytes, fmtDuration, fmtElapsed, fmtRows } from '../../utils/format'

describe('fmtBytes', () => {
  it('returns 0 B for zero', () => {
    expect(fmtBytes(0)).toBe('0 B')
  })
  it('formats bytes', () => {
    expect(fmtBytes(512)).toBe('512 B')
  })
  it('formats kilobytes', () => {
    expect(fmtBytes(1024)).toBe('1.0 KB')
  })
  it('formats megabytes with one decimal for small values', () => {
    expect(fmtBytes(1.5 * 1024 * 1024)).toBe('1.5 MB')
  })
  it('formats gigabytes', () => {
    expect(fmtBytes(2 * 1024 * 1024 * 1024)).toBe('2.0 GB')
  })
})

describe('fmtDuration', () => {
  it('formats sub-second as ms', () => {
    expect(fmtDuration(500)).toBe('500ms')
  })
  it('formats seconds', () => {
    expect(fmtDuration(5000)).toBe('5.0s')
  })
  it('formats minutes', () => {
    expect(fmtDuration(90_000)).toBe('1m 30s')
  })
  it('formats whole minutes without seconds', () => {
    expect(fmtDuration(120_000)).toBe('2m')
  })
})

describe('fmtElapsed', () => {
  it('formats sub-second', () => {
    expect(fmtElapsed(0.5)).toBe('500ms')
  })
  it('formats seconds', () => {
    expect(fmtElapsed(45)).toBe('45.0s')
  })
  it('formats minutes', () => {
    expect(fmtElapsed(90)).toBe('1m 30s')
  })
})

describe('fmtRows', () => {
  it('returns plain number for < 1K', () => {
    expect(fmtRows(999)).toBe('999')
  })
  it('formats thousands', () => {
    expect(fmtRows(1500)).toBe('1.5K')
  })
  it('formats millions', () => {
    expect(fmtRows(2_500_000)).toBe('2.5M')
  })
  it('formats billions', () => {
    expect(fmtRows(1_000_000_000)).toBe('1.0B')
  })
})
