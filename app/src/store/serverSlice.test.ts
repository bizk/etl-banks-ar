import { describe, expect, it } from 'vitest';
import { apiBaseUrl, normalizeServerUrl } from './serverSlice';

describe('server address', () => {
  it.each([
    ['192.168.100.181', 'http://192.168.100.181'],
    ['  192.168.100.181/  ', 'http://192.168.100.181'],
    ['192.168.100.181:8080', 'http://192.168.100.181:8080'],
    ['http://pi.local/api/v1', 'http://pi.local'],
    ['https://tostado.example.ts.net', 'https://tostado.example.ts.net'],
    ['', ''],
  ])('reads %j as %j', (input, expected) => {
    expect(normalizeServerUrl(input)).toBe(expected);
  });

  it('rejects something that is not an address', () => {
    expect(() => normalizeServerUrl('not an address')).toThrow();
  });

  it('uses this origin when no server is set', () => {
    expect(apiBaseUrl('')).toBe('/api/v1');
    expect(apiBaseUrl('http://192.168.100.181')).toBe('http://192.168.100.181/api/v1');
  });
});
