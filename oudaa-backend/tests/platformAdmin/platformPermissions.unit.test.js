const {
  PLATFORM_PERMISSIONS,
  ROLE_PERMISSIONS,
  roleHasPermission,
  isMfaMandatoryForRole,
  ALL_PERMISSIONS,
} = require('../../src/config/platformPermissions');

describe('platformPermissions', () => {
  it('SUPER_ADMIN has every defined permission', () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(roleHasPermission('SUPER_ADMIN', permission)).toBe(true);
    }
  });

  it('a role with no mapping (unknown role) has no permissions', () => {
    expect(roleHasPermission('NOT_A_REAL_ROLE', PLATFORM_PERMISSIONS.DASHBOARD_VIEW)).toBe(false);
  });

  it('SUPPORT_AGENT cannot manage communities', () => {
    expect(roleHasPermission('SUPPORT_AGENT', PLATFORM_PERMISSIONS.COMMUNITIES_MANAGE)).toBe(false);
  });

  it('SUPPORT_AGENT can view/manage support', () => {
    expect(roleHasPermission('SUPPORT_AGENT', PLATFORM_PERMISSIONS.SUPPORT_VIEW)).toBe(true);
    expect(roleHasPermission('SUPPORT_AGENT', PLATFORM_PERMISSIONS.SUPPORT_MANAGE)).toBe(true);
  });

  it('FINANCE_OPERATOR cannot manage feature flags or maintenance', () => {
    expect(roleHasPermission('FINANCE_OPERATOR', PLATFORM_PERMISSIONS.FEATURE_FLAGS_MANAGE)).toBe(false);
    expect(roleHasPermission('FINANCE_OPERATOR', PLATFORM_PERMISSIONS.MAINTENANCE_MANAGE)).toBe(false);
  });

  it('SECURITY_AUDITOR can view audit and security but not manage settings', () => {
    expect(roleHasPermission('SECURITY_AUDITOR', PLATFORM_PERMISSIONS.AUDIT_VIEW)).toBe(true);
    expect(roleHasPermission('SECURITY_AUDITOR', PLATFORM_PERMISSIONS.SECURITY_VIEW)).toBe(true);
    expect(roleHasPermission('SECURITY_AUDITOR', PLATFORM_PERMISSIONS.SETTINGS_MANAGE)).toBe(false);
  });

  it('every role in ROLE_PERMISSIONS only references real permission constants', () => {
    const validSet = new Set(ALL_PERMISSIONS);
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      for (const p of perms) {
        expect(validSet.has(p)).toBe(true);
      }
      expect(role).toBeTruthy();
    }
  });

  it('MFA is mandatory for SUPER_ADMIN and SECURITY_AUDITOR only', () => {
    expect(isMfaMandatoryForRole('SUPER_ADMIN')).toBe(true);
    expect(isMfaMandatoryForRole('SECURITY_AUDITOR')).toBe(true);
    expect(isMfaMandatoryForRole('SUPPORT_AGENT')).toBe(false);
    expect(isMfaMandatoryForRole('OPERATIONS')).toBe(false);
    expect(isMfaMandatoryForRole('FINANCE_OPERATOR')).toBe(false);
    expect(isMfaMandatoryForRole('PLATFORM_ADMIN')).toBe(false);
  });
});
