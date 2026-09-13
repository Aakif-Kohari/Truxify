import { describe, it, expect } from 'vitest';
import { BasePolicy } from '../../src/core/auth/BasePolicy.js';
import { Permission } from '../../src/core/auth/Permission.js';

describe('BasePolicy', () => {
  it('should throw an error when namespace is not a non-empty string', () => {
    expect(() => new BasePolicy()).toThrow('BasePolicy requires a non-empty namespace string.');
    expect(() => new BasePolicy('')).toThrow('BasePolicy requires a non-empty namespace string.');
    expect(() => new BasePolicy(null)).toThrow('BasePolicy requires a non-empty namespace string.');
    expect(() => new BasePolicy(123)).toThrow('BasePolicy requires a non-empty namespace string.');
  });

  it('should define a permission and add it to the policy', () => {
    const policy = new BasePolicy('order');
    const perm = policy.define({ action: 'read', description: 'Read orders' });

    expect(perm).toBeInstanceOf(Permission);
    expect(policy.getPermissions()).toHaveLength(1);
    expect(policy.getPermissions()[0]).toBe(perm);
  });

  it('should accumulate multiple defined permissions correctly', () => {
    const policy = new BasePolicy('order');
    const p1 = policy.define({ action: 'read', description: 'Read' });
    const p2 = policy.define({ action: 'write', description: 'Write' });

    const permissions = policy.getPermissions();
    expect(permissions).toHaveLength(2);
    expect(permissions[0]).toBe(p1);
    expect(permissions[1]).toBe(p2);
  });

  it('should return a Map of action -> Permission via toMap()', () => {
    const policy = new BasePolicy('order');
    const p1 = policy.define({ action: 'read', description: 'Read' });
    const p2 = policy.define({ action: 'write', description: 'Write' });

    const map = policy.toMap();
    expect(map).toBeInstanceOf(Map);
    expect(map.size).toBe(2);
    expect(map.get('read')).toBe(p1);
    expect(map.get('write')).toBe(p2);
  });
});