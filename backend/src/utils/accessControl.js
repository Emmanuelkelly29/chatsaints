'use strict';

const ROLE_TIER = {
  ysa_member:             1,
  missionary:             1,
  ysa_rep:                2,
  ysa_couple_adviser:     2,
  bishop:                 3,
  stake_presidency:       4,
  coordinating_council:   5,
  mission_president:      5,
  mission_president_wife: 5,
  area_authority:         6,
  area_presidency:        7,
  general_authority:      8,
  apostle:                9,
  first_presidency:       10,
  it_support:             11,
};

const HIDDEN_ROLES = new Set([
  'area_authority', 'area_presidency', 'general_authority', 'apostle', 'first_presidency',
]);

const APPROVAL_REQUIRED_ROLES = new Set([
  'missionary',
  'ysa_rep', 'ysa_couple_adviser', 'bishop', 'stake_presidency', 'coordinating_council',
  'mission_president', 'mission_president_wife', 'area_authority', 'area_presidency',
  'general_authority', 'apostle', 'first_presidency',
]);

const canViewProfile = (viewer, target) => {
  if (viewer.id === target.id) return true;

  // IT Support can see everyone
  if (viewer.role === 'it_support') return true;

  // Missionary scope
  if (viewer.role === 'missionary' || viewer.missionary_mode_active) {
    if (target.role === 'missionary') return viewer.mission_id === target.mission_id;
    if (target.role === 'mission_president' || target.role === 'mission_president_wife') {
      return viewer.mission_id === target.mission_president_mission_id;
    }
    return false;
  }

  // Mission president global visibility
  if (viewer.role === 'mission_president' || viewer.role === 'mission_president_wife') {
    if (target.role === 'mission_president' || target.role === 'mission_president_wife') return true;
    if (target.role === 'missionary') {
      return target.mission_id === viewer.mission_president_mission_id;
    }
  }

  // Hidden senior leaders — only visible to same tier or above
  if (HIDDEN_ROLES.has(target.role)) {
    return (ROLE_TIER[viewer.role] || 0) >= (ROLE_TIER[target.role] || 0);
  }

  // YSA members can see leaders above them (bishops, stake presidents, etc.)
  // Leaders can see members below them — both directions are allowed
  // Only hidden senior leaders are restricted (handled above)
  return true;
};

const canSearchUser = (viewer, target) => canViewProfile(viewer, target);

/**
 * 1-on-1 chat: the higher-tier user initiates downward, OR peers chat freely.
 * A bishop can initiate a chat with a YSA member (pastoral duty).
 * The rule: at least one party must be able to see the other.
 */
const canChat1on1 = (viewer, target) => {
  // Missionaries: mission-scoped only
  if (viewer.role === 'missionary' || viewer.missionary_mode_active) {
    if (target.role === 'missionary') return viewer.mission_id === target.mission_id;
    if (target.role === 'mission_president' || target.role === 'mission_president_wife') {
      return viewer.mission_id === target.mission_president_mission_id;
    }
    return false;
  }
  // At least one side must be able to see the other
  return canViewProfile(viewer, target) || canViewProfile(target, viewer);
};

const canAccessStakePool = (user) => {
  if (user.missionary_mode_active) return false;
  if (user.status === 'missionary') return false;
  if (user.role === 'missionary') return false;
  return true;
};

const canJoinGroup = (user, conversation) => {
  if (user.missionary_mode_active || user.role === 'missionary') {
    if (!conversation.mission_id) return false;
    return conversation.mission_id === user.mission_id;
  }
  return true;
};

const isMissionaryLocked = (user) =>
  user.missionary_mode_active === true ||
  user.status === 'missionary' ||
  user.role === 'missionary';

const getUserFeatureFlags = (user) => {
  const locked = isMissionaryLocked(user);
  return {
    canBrowseStakePool:      !locked,
    canCreateOpenGroups:     !locked,
    canJoinCrossStakeGroups: !locked,
    canViewYSADirectory:     !locked,
    canSearchGlobally:       true,
    canSendMessages:         true,
    canMakeVoiceCalls:       true,
    canMakeVideoCalls:       true,
    canSendMedia:            true,
    canPinChats:             true,
    canViewScriptures:       true,
    missionaryModeActive:    locked,
    missionScopedOnly:       locked,
  };
};

const requiresLeaderApproval = (role) => APPROVAL_REQUIRED_ROLES.has(role);

const minApproverTierFor = (role) => ROLE_TIER[role] || 0;

const canReceiveContactRequest = (sender, recipient, preference = 'approved_pool') => {
  if (!sender || !recipient) return false;
  if (sender.id === recipient.id) return false;
  if (!canChat1on1(sender, recipient)) return false;

  switch (preference) {
    case 'same_stake':
      return !!sender.stake_id && sender.stake_id === recipient.stake_id;
    case 'nobody':
      return false;
    case 'approved_pool':
    default:
      return true;
  }
};

module.exports = {
  ROLE_TIER, HIDDEN_ROLES,
  canViewProfile, canSearchUser, canChat1on1,
  canAccessStakePool, canJoinGroup, isMissionaryLocked,
  getUserFeatureFlags, requiresLeaderApproval, minApproverTierFor,
  canReceiveContactRequest,
};
