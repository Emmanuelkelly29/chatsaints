'use strict';
/**
 * ACCESS CONTROL ENGINE — Unit Tests
 * Tests every visibility rule in the hierarchy without needing a database.
 */

const {
  canViewProfile,
  canChat1on1,
  canAccessStakePool,
  canJoinGroup,
  isMissionaryLocked,
  getUserFeatureFlags,
  requiresLeaderApproval,
  ROLE_TIER,
} = require('../src/utils/accessControl');

// ── Helpers ──────────────────────────────────────────────────────
const makeUser = (overrides = {}) => ({
  id: 'user-001',
  role: 'ysa_member',
  status: 'active',
  stake_id: 'stake-001',
  mission_id: null,
  mission_president_mission_id: null,
  missionary_mode_active: false,
  profile_hidden: false,
  ...overrides,
});

// ── ROLE_TIER Tests ──────────────────────────────────────────────
describe('ROLE_TIER', () => {
  test('ysa_member has tier 1', () => {
    expect(ROLE_TIER['ysa_member']).toBe(1);
  });
  test('missionary has tier 1', () => {
    expect(ROLE_TIER['missionary']).toBe(1);
  });
  test('bishop has tier 3', () => {
    expect(ROLE_TIER['bishop']).toBe(3);
  });
  test('stake_presidency has tier 4', () => {
    expect(ROLE_TIER['stake_presidency']).toBe(4);
  });
  test('area_presidency has tier 7', () => {
    expect(ROLE_TIER['area_presidency']).toBe(7);
  });
  test('first_presidency has tier 10', () => {
    expect(ROLE_TIER['first_presidency']).toBe(10);
  });
});

// ── canViewProfile Tests ─────────────────────────────────────────
describe('canViewProfile', () => {
  test('user can always view their own profile', () => {
    const u = makeUser({ id: 'same-id' });
    expect(canViewProfile(u, u)).toBe(true);
  });

  test('YSA member can view another YSA member', () => {
    const viewer = makeUser({ id: 'u1', role: 'ysa_member' });
    const target = makeUser({ id: 'u2', role: 'ysa_member' });
    expect(canViewProfile(viewer, target)).toBe(true);
  });

  test('YSA member cannot view stake presidency profile', () => {
    const viewer = makeUser({ id: 'u1', role: 'ysa_member' });
    const target = makeUser({ id: 'u2', role: 'stake_presidency' });
    expect(canViewProfile(viewer, target)).toBe(false);
  });

  test('bishop can view YSA member', () => {
    const viewer = makeUser({ id: 'u1', role: 'bishop' });
    const target = makeUser({ id: 'u2', role: 'ysa_member' });
    expect(canViewProfile(viewer, target)).toBe(true);
  });

  test('bishop cannot view stake_presidency (hidden peer-up rule)', () => {
    const viewer = makeUser({ id: 'u1', role: 'bishop' });
    const target = makeUser({ id: 'u2', role: 'stake_presidency' });
    expect(canViewProfile(viewer, target)).toBe(false);
  });

  test('stake_presidency can view bishop', () => {
    const viewer = makeUser({ id: 'u1', role: 'stake_presidency' });
    const target = makeUser({ id: 'u2', role: 'bishop' });
    expect(canViewProfile(viewer, target)).toBe(true);
  });

  test('area_authority cannot be seen by stake_presidency', () => {
    const viewer = makeUser({ id: 'u1', role: 'stake_presidency' });
    const target = makeUser({ id: 'u2', role: 'area_authority' });
    expect(canViewProfile(viewer, target)).toBe(false);
  });

  test('general_authority can see area_authority', () => {
    const viewer = makeUser({ id: 'u1', role: 'general_authority' });
    const target = makeUser({ id: 'u2', role: 'area_authority' });
    expect(canViewProfile(viewer, target)).toBe(true);
  });

  test('first_presidency can see everyone', () => {
    const fp = makeUser({ id: 'u1', role: 'first_presidency' });
    const roles = ['ysa_member','bishop','stake_presidency','area_authority','apostle'];
    roles.forEach(role => {
      const t = makeUser({ id: 'u2', role });
      expect(canViewProfile(fp, t)).toBe(true);
    });
  });

  // Missionary rules
  test('missionary can see fellow missionary in same mission', () => {
    const viewer = makeUser({ id: 'u1', role: 'missionary', mission_id: 'mission-A' });
    const target = makeUser({ id: 'u2', role: 'missionary', mission_id: 'mission-A' });
    expect(canViewProfile(viewer, target)).toBe(true);
  });

  test('missionary cannot see missionary in different mission', () => {
    const viewer = makeUser({ id: 'u1', role: 'missionary', mission_id: 'mission-A' });
    const target = makeUser({ id: 'u2', role: 'missionary', mission_id: 'mission-B' });
    expect(canViewProfile(viewer, target)).toBe(false);
  });

  test('missionary can see own mission president', () => {
    const viewer = makeUser({ id: 'u1', role: 'missionary', mission_id: 'mission-A' });
    const mp = makeUser({
      id: 'u2', role: 'mission_president',
      mission_president_mission_id: 'mission-A',
    });
    expect(canViewProfile(viewer, mp)).toBe(true);
  });

  test('missionary cannot see mission president from another mission', () => {
    const viewer = makeUser({ id: 'u1', role: 'missionary', mission_id: 'mission-A' });
    const mp = makeUser({
      id: 'u2', role: 'mission_president',
      mission_president_mission_id: 'mission-B',
    });
    expect(canViewProfile(viewer, mp)).toBe(false);
  });

  test('missionary cannot see YSA members', () => {
    const viewer = makeUser({ id: 'u1', role: 'missionary', mission_id: 'mission-A' });
    const target = makeUser({ id: 'u2', role: 'ysa_member' });
    expect(canViewProfile(viewer, target)).toBe(false);
  });

  // Mission president cross-visibility
  test('mission presidents can see each other globally', () => {
    const mp1 = makeUser({ id: 'u1', role: 'mission_president', mission_president_mission_id: 'mission-A' });
    const mp2 = makeUser({ id: 'u2', role: 'mission_president', mission_president_mission_id: 'mission-B' });
    expect(canViewProfile(mp1, mp2)).toBe(true);
  });

  test('mission president cannot see missionaries from another mission', () => {
    const mp = makeUser({ id: 'u1', role: 'mission_president', mission_president_mission_id: 'mission-A' });
    const missionary = makeUser({ id: 'u2', role: 'missionary', mission_id: 'mission-B' });
    expect(canViewProfile(mp, missionary)).toBe(false);
  });

  test('mission president can see own missionaries', () => {
    const mp = makeUser({ id: 'u1', role: 'mission_president', mission_president_mission_id: 'mission-A' });
    const missionary = makeUser({ id: 'u2', role: 'missionary', mission_id: 'mission-A' });
    expect(canViewProfile(mp, missionary)).toBe(true);
  });
});

// ── canChat1on1 Tests ────────────────────────────────────────────
describe('canChat1on1', () => {
  test('two YSA members can chat', () => {
    const a = makeUser({ id: 'u1', role: 'ysa_member' });
    const b = makeUser({ id: 'u2', role: 'ysa_member' });
    expect(canChat1on1(a, b)).toBe(true);
  });

  test('bishop can chat with YSA member', () => {
    const b = makeUser({ id: 'u1', role: 'bishop' });
    const y = makeUser({ id: 'u2', role: 'ysa_member' });
    expect(canChat1on1(b, y)).toBe(true);
  });

  test('missionary can only chat with same-mission members', () => {
    const m = makeUser({ id: 'u1', role: 'missionary', mission_id: 'mission-A' });
    const fellow = makeUser({ id: 'u2', role: 'missionary', mission_id: 'mission-A' });
    const other = makeUser({ id: 'u3', role: 'missionary', mission_id: 'mission-B' });
    expect(canChat1on1(m, fellow)).toBe(true);
    expect(canChat1on1(m, other)).toBe(false);
  });

  test('missionary cannot chat with YSA members', () => {
    const m = makeUser({ id: 'u1', role: 'missionary', mission_id: 'mission-A' });
    const ysa = makeUser({ id: 'u2', role: 'ysa_member' });
    expect(canChat1on1(m, ysa)).toBe(false);
  });
});

// ── isMissionaryLocked Tests ─────────────────────────────────────
describe('isMissionaryLocked', () => {
  test('regular YSA is not locked', () => {
    expect(isMissionaryLocked(makeUser({ role: 'ysa_member' }))).toBe(false);
  });

  test('missionary role is locked', () => {
    expect(isMissionaryLocked(makeUser({ role: 'missionary' }))).toBe(true);
  });

  test('active YSA with missionary_mode_active=true is locked', () => {
    expect(isMissionaryLocked(makeUser({ missionary_mode_active: true }))).toBe(true);
  });

  test('returned missionary (status released) is not locked', () => {
    expect(isMissionaryLocked(makeUser({
      role: 'ysa_member',
      status: 'released_missionary',
      missionary_mode_active: false,
    }))).toBe(false);
  });
});

// ── canAccessStakePool Tests ─────────────────────────────────────
describe('canAccessStakePool', () => {
  test('regular YSA can access pool', () => {
    expect(canAccessStakePool(makeUser({ role: 'ysa_member' }))).toBe(true);
  });

  test('missionary cannot access pool', () => {
    expect(canAccessStakePool(makeUser({
      role: 'missionary',
      status: 'missionary',
      missionary_mode_active: true,
    }))).toBe(false);
  });

  test('YSA with missionary_mode_active cannot access pool', () => {
    expect(canAccessStakePool(makeUser({ missionary_mode_active: true }))).toBe(false);
  });
});

// ── getUserFeatureFlags Tests ────────────────────────────────────
describe('getUserFeatureFlags', () => {
  test('normal YSA has all features enabled', () => {
    const flags = getUserFeatureFlags(makeUser({ role: 'ysa_member' }));
    expect(flags.canBrowseStakePool).toBe(true);
    expect(flags.canCreateOpenGroups).toBe(true);
    expect(flags.canSendMessages).toBe(true);
    expect(flags.missionaryModeActive).toBe(false);
  });

  test('missionary has pool and group features locked', () => {
    const flags = getUserFeatureFlags(makeUser({
      role: 'missionary',
      missionary_mode_active: true,
    }));
    expect(flags.canBrowseStakePool).toBe(false);
    expect(flags.canCreateOpenGroups).toBe(false);
    expect(flags.missionaryModeActive).toBe(true);
    expect(flags.missionScopedOnly).toBe(true);
    // But core messaging still works
    expect(flags.canSendMessages).toBe(true);
    expect(flags.canMakeVoiceCalls).toBe(true);
  });
});

// ── requiresLeaderApproval Tests ─────────────────────────────────
describe('requiresLeaderApproval', () => {
  test('ysa_member does NOT require approval', () => {
    expect(requiresLeaderApproval('ysa_member')).toBe(false);
  });

  test('bishop requires approval', () => {
    expect(requiresLeaderApproval('bishop')).toBe(true);
  });

  test('stake_presidency requires approval', () => {
    expect(requiresLeaderApproval('stake_presidency')).toBe(true);
  });

  test('mission_president requires approval', () => {
    expect(requiresLeaderApproval('mission_president')).toBe(true);
  });

  test('apostle requires approval', () => {
    expect(requiresLeaderApproval('apostle')).toBe(true);
  });
});
