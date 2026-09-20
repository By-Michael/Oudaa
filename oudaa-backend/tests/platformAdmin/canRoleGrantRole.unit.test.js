const {
  canRoleGrantRole,
  getPermissionsForRole,
  ASSIGNABLE_ROLES,
  ALL_PERMISSIONS,
} = require('../../src/config/platformPermissions');

describe('canRoleGrantRole — privilege self-escalation guard', () => {
  it('SUPER_ADMIN can grant every assignable role, including SUPER_ADMIN itself', () => {
    for (const role of ASSIGNABLE_ROLES) {
      expect(canRoleGrantRole('SUPER_ADMIN', role)).toBe(true);
    }
  });

  it('no non-SUPER_ADMIN role can grant SUPER_ADMIN (it has every permission)', () => {
    for (const role of ASSIGNABLE_ROLES) {
      if (role === 'SUPER_ADMIN') continue;
      expect(canRoleGrantRole(role, 'SUPER_ADMIN')).toBe(false);
    }
  });

  it('a role can always grant its own role (permissions are always a subset of themselves)', () => {
    for (const role of ASSIGNABLE_ROLES) {
      expect(canRoleGrantRole(role, role)).toBe(true);
    }
  });

  it('PLATFORM_ADMIN cannot grant SECURITY_AUDITOR (SECURITY_AUDITOR has AUDIT_VIEW/SECURITY_MANAGE/ADMINS_VIEW PLATFORM_ADMIN lacks)', () => {
    expect(canRoleGrantRole('PLATFORM_ADMIN', 'SECURITY_AUDITOR')).toBe(false);
  });

  it('SECURITY_AUDITOR cannot grant PLATFORM_ADMIN (PLATFORM_ADMIN has COMMUNITIES_MANAGE/USERS_MANAGE SECURITY_AUDITOR lacks)', () => {
    expect(canRoleGrantRole('SECURITY_AUDITOR', 'PLATFORM_ADMIN')).toBe(false);
  });

  it('a role can grant a strictly narrower role (SUPPORT_AGENT permissions are a subset of PLATFORM_ADMIN)', () => {
    const supportPerms = new Set(getPermissionsForRole('SUPPORT_AGENT'));
    const platformAdminPerms = new Set(getPermissionsForRole('PLATFORM_ADMIN'));
    const isSubset = [...supportPerms].every((p) => platformAdminPerms.has(p));
    expect(isSubset).toBe(true);
    expect(canRoleGrantRole('PLATFORM_ADMIN', 'SUPPORT_AGENT')).toBe(true);
  });

  it('returns false for an unknown target role from any granter except SUPER_ADMIN', () => {
    expect(canRoleGrantRole('PLATFORM_ADMIN', 'NOT_A_REAL_ROLE')).toBe(false);
  });

  it('an unknown granter role can grant nothing (not even to itself)', () => {
    expect(canRoleGrantRole('NOT_A_REAL_ROLE', 'SUPPORT_AGENT')).toBe(false);
  });

  it('getPermissionsForRole never returns permissions outside the global catalog', () => {
    for (const role of ASSIGNABLE_ROLES) {
      for (const p of getPermissionsForRole(role)) {
        expect(ALL_PERMISSIONS).toContain(p);
      }
    }
  });
});
