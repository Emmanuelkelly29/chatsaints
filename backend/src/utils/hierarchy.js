/**
 * LDS YSA App — Hierarchy & Access Control Engine
 * Every permission check in the app flows through this file.
 */

const ROLE_LEVEL = {
  YSA_MEMBER:                  1,
  MISSIONARY:                  1,
  YSA_REP:                     2,
  YSA_COUPLE_ADVISER:          2,
  BISHOP:                      3,
  DISTRICT_PRESIDENT:          3,
  STAKE_PRESIDENT:             4,
  COORDINATING_COUNCIL_LEADER: 5,
  AREA_AUTHORITY:              6,
  MISSION_PRESIDENT:           6,
  MISSION_PRESIDENT_WIFE:      6,
  AREA_PRESIDENCY:             7,
  GENERAL_AUTHORITY:           8,
  APOSTLE:                     9,
  FIRST_PRESIDENCY:            10,
  IT_SUPPORT:                  11,
};

// Roles whose profiles are hidden from those below them
const HIDDEN_ROLES = new Set([
  'COORDINATING_COUNCIL_LEADER',
  'AREA_AUTHORITY',
  'MISSION_PRESIDENT',
  'MISSION_PRESIDENT_WIFE',
  'AREA_PRESIDENCY',
  'GENERAL_AUTHORITY',
  'APOSTLE',
  'FIRST_PRESIDENCY',
]);

const MISSIONARY_ROLES = new Set(['MISSIONARY', 'MISSION_PRESIDENT', 'MISSION_PRESIDENT_WIFE']);

/**
 * Can viewer see target's profile?
 */
function canViewProfile(viewer, target) {
  const viewerLevel = ROLE_LEVEL[viewer.role] || 1;
  const targetLevel = ROLE_LEVEL[target.role] || 1;

  // IT Support can see everyone
  if (viewer.role === 'IT_SUPPORT') return true;

  // Missionaries: mission-scoped only
  if (viewer.role === 'MISSIONARY') {
    if (target.role === 'MISSIONARY') return viewer.missionId === target.missionId;
    if (['MISSION_PRESIDENT', 'MISSION_PRESIDENT_WIFE'].includes(target.role)) {
      return viewer.missionId === target.missionPresidentOfId ||
             viewer.missionId === target.missionPresidentWifeOfId;
    }
    return false;
  }

  // Mission Presidents: can see each other + own missionaries
  if (viewer.role === 'MISSION_PRESIDENT' || viewer.role === 'MISSION_PRESIDENT_WIFE') {
    if (['MISSION_PRESIDENT', 'MISSION_PRESIDENT_WIFE'].includes(target.role)) return true;
    if (target.role === 'MISSIONARY') {
      return target.missionId === viewer.missionPresidentOfId ||
             target.missionId === viewer.missionPresidentWifeOfId;
    }
  }

  // Hidden role check — higher roles can't be seen by lower ones
  if (HIDDEN_ROLES.has(target.role) && viewerLevel < targetLevel) return false;

  // Leaders see one level down, not up
  if (viewerLevel >= targetLevel) return true;

  // YSA members see other YSA members via pool
  if (viewer.role === 'YSA_MEMBER' && target.role === 'YSA_MEMBER') return true;

  return false;
}

/**
 * Can viewer search for target?
 */
function canSearchUser(viewer, target) {
  if (viewer.id === target.id) return true;
  return canViewProfile(viewer, target);
}

/**
 * Can this user use the full app (not in missionary lock)?
 */
function hasFullAccess(user) {
  return user.accountStatus === 'ACTIVE' && user.role !== 'MISSIONARY';
}

/**
 * Can viewer start a 1-on-1 chat with target?
 * 1-on-1 is available to everyone regardless of role.
 */
function canChat(viewer, target) {
  if (viewer.accountStatus !== 'ACTIVE') return false;
  if (viewer.role === 'MISSIONARY') {
    // Missionaries can only chat within their mission
    if (target.role === 'MISSIONARY') return viewer.missionId === target.missionId;
    if (['MISSION_PRESIDENT', 'MISSION_PRESIDENT_WIFE'].includes(target.role)) {
      return viewer.missionId === target.missionPresidentOfId ||
             viewer.missionId === target.missionPresidentWifeOfId;
    }
    return false;
  }
  return canViewProfile(viewer, target);
}

/**
 * Check if a role requires leader approval on sign-up
 */
function requiresLeaderApproval(role) {
  return ROLE_LEVEL[role] >= 2;
}

/**
 * Get the profile fields visible to the viewer
 * (strips phone/email from profiles they shouldn't have contact details for)
 */
function sanitizeProfile(viewer, target) {
  const viewerLevel = ROLE_LEVEL[viewer.role] || 1;
  const targetLevel = ROLE_LEVEL[target.role] || 1;

  const base = {
    id: target.id,
    firstName: target.firstName,
    lastName: target.lastName,
    profilePhoto: target.profilePhoto,
    role: target.role,
    unitId: target.unitId,
    lastSeen: target.lastSeen,
  };

  // Full contact info only if viewer is at same level or above
  if (viewerLevel >= targetLevel || viewer.unitId === target.unitId) {
    base.phone = target.phone;
    base.email = target.email;
  }

  return base;
}

module.exports = {
  ROLE_LEVEL,
  HIDDEN_ROLES,
  MISSIONARY_ROLES,
  canViewProfile,
  canSearchUser,
  hasFullAccess,
  canChat,
  requiresLeaderApproval,
  sanitizeProfile,
};
