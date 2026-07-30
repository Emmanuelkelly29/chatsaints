import { HIDDEN_ROLES, tierOf } from "../../domain/roles";
import type {
  ContactRequestPreference,
  LeadershipRole,
  UserStatus,
} from "../../generated/prisma/enums";

/**
 * Shared access-control predicates: who may see whom, who may open a 1-on-1
 * chat, who may browse the YSA pool, and who may receive a contact request.
 *
 * Ported from utils/accessControl.js. The role tier table that lived there is
 * gone: it omitted `district_presidency` and `ysa_adviser`, so every guard
 * written as `ROLE_TIER[role] < 4` evaluated `undefined < 4` and let those roles
 * straight through. Tiers now come from domain/roles.ts, which is exhaustive
 * over the role enum.
 *
 * These are pure predicates. Anything that throws lives in scope.ts, so the
 * rules can be reasoned about and tested without an Express request.
 */

/** The fields any profile-visibility decision depends on. */
export interface ProfileParty {
  id: string;
  role: LeadershipRole;
  missionId: string | null;
  missionPresidentMissionId: string | null;
  missionaryModeActive: boolean;
}

/** Select clause loading exactly what {@link canViewProfile} needs. */
export const PROFILE_PARTY_SELECT = {
  id: true,
  role: true,
  missionId: true,
  missionPresidentMissionId: true,
  missionaryModeActive: true,
} as const;

/** True while a person is serving, or has switched their account into mission mode. */
function isMissionScoped(party: Pick<ProfileParty, "role" | "missionaryModeActive">): boolean {
  return party.role === "missionary" || party.missionaryModeActive;
}

function isMissionLeader(party: Pick<ProfileParty, "role">): boolean {
  return party.role === "mission_president" || party.role === "mission_president_wife";
}

/**
 * Two people are in the same mission only when the mission is actually known.
 *
 * The old comparisons were bare `viewer.mission_id === target.mission_id`, which
 * is true when both sides are null. A missionary with no mission assigned could
 * therefore see every other unassigned missionary, and every mission president
 * whose presiding mission was unset.
 */
function sameMission(left: string | null, right: string | null): boolean {
  return left !== null && left === right;
}

/** Whether `viewer` is allowed to see `target`'s profile at all. */
export function canViewProfile(viewer: ProfileParty, target: ProfileParty): boolean {
  if (viewer.id === target.id) return true;

  // IT support is named explicitly here rather than short-circuiting every
  // check in the middleware, so its reach stays visible at the call site.
  if (viewer.role === "it_support") return true;

  // A serving missionary sees their own mission and nothing else.
  if (isMissionScoped(viewer)) {
    if (target.role === "missionary") return sameMission(viewer.missionId, target.missionId);
    if (isMissionLeader(target)) {
      return sameMission(viewer.missionId, target.missionPresidentMissionId);
    }
    return false;
  }

  // Mission leadership sees peer mission leadership anywhere, and the
  // missionaries of the mission they preside over.
  if (isMissionLeader(viewer)) {
    if (isMissionLeader(target)) return true;
    if (target.role === "missionary") {
      return sameMission(viewer.missionPresidentMissionId, target.missionId);
    }
  }

  // Senior leaders are hidden from anyone below their tier.
  if (HIDDEN_ROLES.has(target.role)) return tierOf(viewer.role) >= tierOf(target.role);

  // Otherwise members and leaders can see each other in both directions.
  return true;
}

/**
 * 1-on-1 chat eligibility.
 *
 * A higher-tier leader may open a chat downward (pastoral duty) and peers may
 * chat freely, so it is enough that one side can see the other. Missionaries
 * stay mission-scoped in both directions.
 */
export function canChat1on1(viewer: ProfileParty, target: ProfileParty): boolean {
  if (isMissionScoped(viewer)) {
    if (target.role === "missionary") return sameMission(viewer.missionId, target.missionId);
    if (isMissionLeader(target)) {
      return sameMission(viewer.missionId, target.missionPresidentMissionId);
    }
    return false;
  }
  return canViewProfile(viewer, target) || canViewProfile(target, viewer);
}

// ─── Pool access ────────────────────────────────────────────────────────────

export interface PoolAccessParty {
  role: LeadershipRole;
  status: UserStatus;
  missionaryModeActive: boolean;
}

/** A serving missionary's account is restricted to mission-scoped features. */
export function isMissionaryLocked(user: PoolAccessParty): boolean {
  return user.missionaryModeActive || user.status === "missionary" || user.role === "missionary";
}

/**
 * Whether a person may browse the YSA pool and directory.
 *
 * The old ysaPool.js routes never consulted this: `GET /global` handed the
 * worldwide pool to any caller, missionaries included, which contradicts both
 * this predicate and canViewProfile (a missionary cannot see a YSA member's
 * profile). Missionaries use the mission directory instead.
 */
export function canAccessStakePool(user: PoolAccessParty): boolean {
  return !isMissionaryLocked(user);
}

// ─── Mission directory scope ────────────────────────────────────────────────

/**
 * Which missions' rosters a caller may read.
 *
 * `null` means every mission. The old missionary endpoints let any caller list
 * the missionaries of any mission by id, so a missionary could enumerate other
 * missions despite being mission-scoped everywhere else.
 */
export function visibleMissionIds(
  user: Pick<ProfileParty, "role" | "missionId" | "missionPresidentMissionId" | "missionaryModeActive">,
): string[] | null {
  if (user.role === "it_support") return null;
  if (isMissionScoped(user)) return user.missionId ? [user.missionId] : [];
  if (isMissionLeader(user)) {
    return user.missionPresidentMissionId ? [user.missionPresidentMissionId] : [];
  }
  return null;
}

// ─── Contact requests ───────────────────────────────────────────────────────

export interface ContactRequester extends ProfileParty {
  stakeId: string | null;
  districtId: string | null;
}

export interface ContactCandidate extends ContactRequester {
  status: UserStatus;
  isApproved: boolean;
  profileHidden: boolean;
  directoryVisible: boolean;
  contactRequestPreference: ContactRequestPreference;
}

/**
 * Columns a contact-request decision needs about the recipient.
 *
 * `directoryVisible` and `contactRequestPreference` are the whole point of this
 * constant. conversationController.getUserChatSummary never selected them, yet
 * the contact-request path branched on `recipient.directory_visible === false`
 * and passed `recipient.contact_request_preference` into the permission check.
 * Both were always `undefined`, so the branch never fired and the preference
 * check fell through to its permissive default: a user who chose "nobody" still
 * received requests from anyone.
 */
export const CONTACT_CANDIDATE_SELECT = {
  ...PROFILE_PARTY_SELECT,
  stakeId: true,
  districtId: true,
  status: true,
  isApproved: true,
  profileHidden: true,
  directoryVisible: true,
  contactRequestPreference: true,
} as const;

/**
 * `hidden` is deliberately indistinguishable from "no such account" at the HTTP
 * layer, so probing ids cannot confirm that a hidden user exists.
 */
export type ContactBlockReason = "self" | "hidden" | "unreachable" | "preference";

export type ContactEligibility = { ok: true } | { ok: false; reason: ContactBlockReason };

/** Both parties count as reachable only while their account is in use. */
export function isReachableAccount(status: UserStatus): boolean {
  return status === "active" || status === "missionary";
}

/** Same home unit: a district is a peer of a stake, never a child of one. */
export function sharesHomeUnit(left: ContactRequester, right: ContactRequester): boolean {
  if (left.stakeId !== null && left.stakeId === right.stakeId) return true;
  return left.districtId !== null && left.districtId === right.districtId;
}

/** Whether `sender` may send `recipient` a contact request, and if not, why. */
export function contactRequestEligibility(
  sender: ContactRequester,
  recipient: ContactCandidate,
): ContactEligibility {
  if (sender.id === recipient.id) return { ok: false, reason: "self" };

  // Anything that means "this account is not open to being found" collapses into
  // one reason, which the route reports as a plain 404.
  if (
    !recipient.isApproved ||
    recipient.profileHidden ||
    !recipient.directoryVisible ||
    !isReachableAccount(recipient.status)
  ) {
    return { ok: false, reason: "hidden" };
  }

  // Checked before the one-way visibility test below so a mission-scoped sender
  // is told they cannot reach outside their mission, rather than being handed a
  // "no such user" that is really about their own restriction. This branch only
  // fires on mission scoping, so it reveals nothing about the recipient.
  if (!canChat1on1(sender, recipient)) return { ok: false, reason: "unreachable" };

  // The sender cannot see the recipient at all, a hidden senior leader for
  // instance. Same 404 as a missing account.
  if (!canViewProfile(sender, recipient)) return { ok: false, reason: "hidden" };

  switch (recipient.contactRequestPreference) {
    case "nobody":
      return { ok: false, reason: "preference" };
    case "same_stake":
      return sharesHomeUnit(sender, recipient) ? { ok: true } : { ok: false, reason: "preference" };
    case "approved_pool":
      // Kept permissive, as the old default was. Narrowing this to "must already
      // be an approved pool member" would also cut off members contacting their
      // own leaders, which is a policy change rather than a defect fix.
      return { ok: true };
  }
}
