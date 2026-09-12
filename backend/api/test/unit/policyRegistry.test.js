import { describe, it, expect, beforeEach } from 'vitest';
import PolicyRegistry from '../../src/core/auth/PolicyRegistry.js';
import { Permission } from '../../src/core/auth/Permission.js';

describe('PolicyRegistry', () => {
    let registry;

    beforeEach(() => {
        registry = new PolicyRegistry();
    });

    it('should register a permission object and return it', () => {
        const permOpts = { action: 'read:users', description: 'Read users' };
        const perm = registry.register(permOpts);
        expect(perm).toBeInstanceOf(Permission);
        expect(perm.action).toBe('read:users');
        expect(registry.size).toBe(1);
    });

    it('should register a Permission instance directly', () => {
        const permission = new Permission({ action: 'write:users', description: 'Write users' });
        const perm = registry.register(permission);
        expect(perm).toBe(permission);
        expect(registry.size).toBe(1);
    });

    it('should throw when an action is already registered', () => {
        registry.register({ action: 'read:users', description: 'Read users' });
        expect(() => {
            registry.register({ action: 'read:users', description: 'Duplicate read users' });
        }).toThrowError('Permission already registered for action: read:users');
    });

    it('should register multiple permissions using registerAll', () => {
        registry.registerAll([
            { action: 'read:users', description: 'Read users' },
            { action: 'write:users', description: 'Write users' }
        ]);
        expect(registry.size).toBe(2);
        expect(registry.has('read:users')).toBe(true);
        expect(registry.has('write:users')).toBe(true);
    });

    it('should register from a BasePolicy module using registerPolicy', () => {
        const mockPolicyModule = {
            getPermissions: () => [
                { action: 'delete:users', description: 'Delete users' }
            ]
        };
        registry.registerPolicy(mockPolicyModule);
        expect(registry.size).toBe(1);
        expect(registry.get('delete:users')).toBeInstanceOf(Permission);
    });

    it('should return the correct permission via get', () => {
        registry.register({ action: 'update:profile', description: 'Update profile' });
        const perm = registry.get('update:profile');
        expect(perm).toBeDefined();
        expect(perm.action).toBe('update:profile');
        expect(registry.get('nonexistent')).toBeUndefined();
    });

    it('should return true/false correctly via has', () => {
        registry.register({ action: 'view:dashboard', description: 'View dashboard' });
        expect(registry.has('view:dashboard')).toBe(true);
        expect(registry.has('nonexistent')).toBe(false);
    });

    it('should return sorted action names via listActions', () => {
        registry.register({ action: 'b:action', description: 'B' });
        registry.register({ action: 'a:action', description: 'A' });
        const actions = registry.listActions();
        expect(actions).toEqual(['a:action', 'b:action']);
    });

    it('should return all permission objects via listPermissions', () => {
        registry.register({ action: 'action:one', description: 'One' });
        registry.register({ action: 'action:two', description: 'Two' });
        const perms = registry.listPermissions();
        expect(perms.length).toBe(2);
        expect(perms[0]).toBeInstanceOf(Permission);
    });

    it('should return the correct count via size getter', () => {
        expect(registry.size).toBe(0);
        registry.register({ action: 'test:action', description: 'Test' });
        expect(registry.size).toBe(1);
    });

    it('should produce a valid JSON object snapshot with correct count and policies', () => {
        registry.register({ action: 'snap:action', description: 'Snapshot' });
        const snap = registry.snapshot();
        expect(snap).toBeDefined();
        expect(snap.totalPermissions).toBe(1);
        expect(snap.policies).toHaveProperty('snap:action');
    });
});
