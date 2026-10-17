import { formatBytes, formatDuration, relativeTime, shortModelName } from './format';

describe('format helpers', () => {
  it('formats bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(10 * 1024 * 1024)).toBe('10.0 MB');
    expect(formatBytes(-1)).toBe('n/a');
    expect(formatBytes(Number.NaN)).toBe('n/a');
  });

  it('formats relative times', () => {
    const now = new Date('2025-06-01T12:00:00Z').getTime();
    expect(relativeTime('2025-06-01T11:59:50Z', now)).toBe('just now');
    expect(relativeTime('2025-06-01T11:30:00Z', now)).toBe('30 min ago');
    expect(relativeTime('2025-06-01T09:00:00Z', now)).toBe('3 h ago');
    expect(relativeTime('2025-05-30T12:00:00Z', now)).toBe('2 d ago');
    expect(relativeTime('garbage', now)).toBe('n/a');
  });

  it('formats durations and model names', () => {
    expect(formatDuration(850)).toBe('850 ms');
    expect(formatDuration(14250)).toBe('14.3 s');
    expect(shortModelName('gemma3:latest')).toBe('gemma3');
    expect(shortModelName('llama3:8b')).toBe('llama3:8b');
  });
});
