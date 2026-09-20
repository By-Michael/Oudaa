'use strict';

const { roleHasPermission, PLATFORM_PERMISSIONS } = require('../../src/config/platformPermissions');

// Phase 4's explicit security requirement: "A support agent should not
// automatically have security-management permissions." This is a
// property of the ROLE_PERMISSIONS map itself, so testing it here means
// it stays true even if the map is edited later without anyone re-reading
// the spec.
describe('Support/security permission separation (Phase 4)', () => {
  it('SUPPORT_AGENT has support permissions', () => {
    expect(roleHasPermission('SUPPORT_AGENT', PLATFORM_PERMISSIONS.SUPPORT_VIEW)).toBe(true);
    expect(roleHasPermission('SUPPORT_AGENT', PLATFORM_PERMISSIONS.SUPPORT_MANAGE)).toBe(true);
  });

  it('SUPPORT_AGENT does NOT have security-management permissions', () => {
    expect(roleHasPermission('SUPPORT_AGENT', PLATFORM_PERMISSIONS.SECURITY_VIEW)).toBe(false);
    expect(roleHasPermission('SUPPORT_AGENT', PLATFORM_PERMISSIONS.SECURITY_MANAGE)).toBe(false);
  });

  it('SECURITY_AUDITOR does NOT automatically have support-management permissions', () => {
    expect(roleHasPermission('SECURITY_AUDITOR', PLATFORM_PERMISSIONS.SUPPORT_MANAGE)).toBe(false);
  });

  it('only SUPER_ADMIN has both support and security management simultaneously', () => {
    const rolesWithBoth = ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'SUPPORT_AGENT', 'OPERATIONS', 'SECURITY_AUDITOR', 'FINANCE_OPERATOR'].filter(
      (role) => roleHasPermission(role, PLATFORM_PERMISSIONS.SUPPORT_MANAGE) && roleHasPermission(role, PLATFORM_PERMISSIONS.SECURITY_MANAGE)
    );
    expect(rolesWithBoth).toEqual(['SUPER_ADMIN']);
  });
});
