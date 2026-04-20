/**
 * HIERARCHY ACCESS ENGINE
 * Controls which roles can see which other roles.
 * Missionaries have a completely separate ruleset.
 */

const ROLE_LEVEL = {
  ysa_member:            1,
  missionary:            1,   // parallel, not above YSA
  ysa_rep:               2,
  ysa_adviser:           2,
  bishop:                3,
  district_presidency:   3,
  stake_presidency:      4,
  coordinating_council:  5,
  area_authority:        6,
  mission_president:     6,   // peer to area authority globally
  mission_president_wife:6,
  area_presidency:       7,
  general_authority:     8,
  apostle:               9,
  first_presidency:      10,
  it_support:            11,
};

// Roles whose profiles are hidden from tiers below them
const HIDDEN_ROLES = new Set([
  'area_presidency',
  'general_authority',
  'apostle',
  'first_presidency',
]);

// Roles that require leader approval before account activates
const REQUIRES_APPROVAL = new Set([
  'ysa_rep',
  'ysa_adviser',
  'bishop',
  'district_presidency',
  'stake_presidency',
  'coordinating_council',
  'area_authority',
  'mission_president',
  'mission_president_wife',
  'area_presidency',
  'general_authority',
  'apostle',
  'first_presidency',
]);

/**
 * Can `viewerRole` see the profile of `targetRole`?
 */
function canViewProfile(viewerRole, targetRole, sameContext = false) {
  // IT Support can see everyone
  if (viewerRole === 'it_support') return true;

  // Missionaries can only see own mission — enforced at query level
  if (viewerRole === 'missionary') {
    return targetRole === 'missionary' ||
           targetRole === 'mission_president' ||
           targetRole === 'mission_president_wife';
  }

  // Hidden roles are invisible to everyone below them
  if (HIDDEN_ROLES.has(targetRole)) {
    const viewerLevel = ROLE_LEVEL[viewerRole] || 0;
    const targetLevel = ROLE_LEVEL[targetRole] || 99;
    return viewerLevel >= targetLevel;
  }

  // Standard: can see same level and below, NOT above
  const viewerLevel = ROLE_LEVEL[viewerRole] || 0;
  const targetLevel = ROLE_LEVEL[targetRole] || 0;
  return viewerLevel >= targetLevel;
}

/**
 * Can `viewerRole` search for `targetRole` in global search?
 */
function canSearchRole(viewerRole, targetRole) {
  if (viewerRole === 'ysa_member') {
    // YSA can only find other YSA in approved pools
    return targetRole === 'ysa_member';
  }
  return canViewProfile(viewerRole, targetRole);
}

/**
 * Can any user send a 1-on-1 message? YES — always.
 */
function canDirectMessage() {
  return true;
}

/**
 * Can a missionary access this feature?
 */
function missionaryAllowed(feature) {
  const ALLOWED = new Set(['direct_message', 'group_chat_mission', 'voice_call_mission', 'video_call_mission']);
  return ALLOWED.has(feature);
}

/**
 * What features are LOCKED when missionary mode is active?
 */
const MISSIONARY_LOCKED_FEATURES = [
  'stake_contact_pool',
  'cross_stake_browse',
  'ysa_programs',
  'group_chat_external',
  'search_global',
  'contact_discovery',
];

/**
 * Given viewer and target users, return what the viewer can see
 */
function getVisibleFields(viewerRole, targetRole, isSameUnit = false) {
  const canView = canViewProfile(viewerRole, targetRole);
  if (!canView) return null;

  // Leaders above bishop can see contact details of levels below
  if (ROLE_LEVEL[viewerRole] >= ROLE_LEVEL['bishop']) {
    return ['full_name', 'phone_number', 'email', 'role', 'stake', 'profile_photo_url', 'last_seen'];
  }

  // YSA members see basic info of other YSA in approved pools
  return ['full_name', 'profile_photo_url', 'stake', 'role'];
}

module.exports = {
  ROLE_LEVEL,
  HIDDEN_ROLES,
  REQUIRES_APPROVAL,
  canViewProfile,
  canSearchRole,
  canDirectMessage,
  missionaryAllowed,
  MISSIONARY_LOCKED_FEATURES,
  getVisibleFields,
};
