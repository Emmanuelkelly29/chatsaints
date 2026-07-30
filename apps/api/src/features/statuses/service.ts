import type { Prisma } from "../../generated/prisma/client";
import {
  StatusMediaType,
  type LeadershipRole,
  type StatusVisibility,
} from "../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import type { AuthenticatedUser } from "../../middleware/auth";
import { badRequest, forbidden, notFound } from "../../middleware/errorHandler";
import type { CreateStatusInput, StatusSettingsInput } from "./schemas";

/**
 * Statuses: 24-hour ephemeral posts with per-status visibility.
 *
 * The visibility model is the whole point of this feature, and the old
 * implementation only enforced it in one of the two places that needed it. See
 * `isVisibleTo` below.
 */

const STATUS_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** Fields returned for a status. Never includes another user's view counts. */
const STATUS_SELECT = {
  id: true,
  mediaUrl: true,
  mediaType: true,
  caption: true,
  textContent: true,
  backgroundColor: true,
  visibility: true,
  durationSecs: true,
  expiresAt: true,
  createdAt: true,
} as const;

/**
 * Missionaries are isolated from the general population, so they do not post
 * statuses. Mirrors the old utils/accessControl.js `isMissionaryLocked`, which
 * read snake_case properties that the new authenticated user type does not have.
 */
function isMissionaryLocked(user: AuthenticatedUser): boolean {
  return user.missionaryModeActive || user.status === "missionary" || user.role === "missionary";
}

interface StatusPreferences {
  stealthStatusView: boolean;
  statusVisibilityDefault: StatusVisibility;
}

/**
 * Loads the caller's status preferences.
 *
 * These two columns are not part of AUTH_USER_SELECT, so they are read here
 * rather than off `req.user`. The old controller did the opposite: it read
 * `user.status_visibility_default` and `user.stealth_status_view` from a request
 * user that never carried either field, so both settings were permanently
 * `undefined`. Every status defaulted to contacts_only regardless of the account
 * default, and stealth viewing never engaged unless the client passed the
 * per-request override.
 */
async function preferencesOf(userId: string): Promise<StatusPreferences> {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { stealthStatusView: true, statusVisibilityDefault: true },
  });
}

// ─── Contact graph ──────────────────────────────────────────────────────────
// "Contact" means one of: an accepted contact connection, a shared active
// conversation, or joint membership of an approved stake or district pool.

/**
 * Every user id the viewer counts as a contact.
 *
 * The old feed expressed this as a correlated-subquery SQL wall that joined
 * `stake_pool_members spm1 ON spm1.stake_id = spm2.stake_id`. Because SQL
 * equality on NULL is never true, district pool members matched nobody, so
 * district pools were invisible to the status feed entirely. Accepted contact
 * connections were not considered at all.
 */
async function contactIdsOf(userId: string): Promise<Set<string>> {
  const contacts = new Set<string>();

  const connections = await prisma.contactConnection.findMany({
    where: { OR: [{ userLowId: userId }, { userHighId: userId }] },
    select: { userLowId: true, userHighId: true },
  });
  for (const connection of connections) {
    contacts.add(connection.userLowId === userId ? connection.userHighId : connection.userLowId);
  }

  const memberships = await prisma.conversationMember.findMany({
    where: { userId, leftAt: null },
    select: { conversationId: true },
  });
  if (memberships.length > 0) {
    const peers = await prisma.conversationMember.findMany({
      where: {
        conversationId: { in: memberships.map((membership) => membership.conversationId) },
        leftAt: null,
        userId: { not: userId },
      },
      select: { userId: true },
    });
    for (const peer of peers) contacts.add(peer.userId);
  }

  const pools = await prisma.stakePoolMember.findMany({
    where: { userId, approved: true },
    select: { stakeId: true, districtId: true },
  });
  const stakeIds = pools.map((pool) => pool.stakeId).filter((id): id is string => id !== null);
  const districtIds = pools.map((pool) => pool.districtId).filter((id): id is string => id !== null);

  const poolFilters: Prisma.StakePoolMemberWhereInput[] = [];
  if (stakeIds.length > 0) poolFilters.push({ stakeId: { in: stakeIds } });
  if (districtIds.length > 0) poolFilters.push({ districtId: { in: districtIds } });

  if (poolFilters.length > 0) {
    const poolPeers = await prisma.stakePoolMember.findMany({
      where: { approved: true, userId: { not: userId }, OR: poolFilters },
      select: { userId: true },
    });
    for (const peer of poolPeers) contacts.add(peer.userId);
  }

  contacts.delete(userId);
  return contacts;
}

/** Whether two specific users are contacts. Single query, for the view path. */
async function areContacts(viewerId: string, ownerId: string): Promise<boolean> {
  if (viewerId === ownerId) return true;

  const low = viewerId < ownerId ? viewerId : ownerId;
  const high = viewerId < ownerId ? ownerId : viewerId;

  const connection = await prisma.contactConnection.findUnique({
    where: { userLowId_userHighId: { userLowId: low, userHighId: high } },
    select: { id: true },
  });
  if (connection) return true;

  const sharedConversation = await prisma.conversationMember.findFirst({
    where: {
      userId: viewerId,
      leftAt: null,
      conversation: { members: { some: { userId: ownerId, leftAt: null } } },
    },
    select: { id: true },
  });
  if (sharedConversation) return true;

  const sharedPool = await prisma.stakePoolMember.findFirst({
    where: {
      userId: viewerId,
      approved: true,
      OR: [
        { stake: { poolMembers: { some: { userId: ownerId, approved: true } } } },
        { district: { poolMembers: { some: { userId: ownerId, approved: true } } } },
      ],
    },
    select: { id: true },
  });
  return sharedPool !== null;
}

async function hasVisibilityGrant(statusId: string, userId: string): Promise<boolean> {
  const grant = await prisma.statusVisibilityUser.findUnique({
    where: { statusId_userId: { statusId, userId } },
    select: { id: true },
  });
  return grant !== null;
}

interface VisibilitySubject {
  id: string;
  userId: string;
  visibility: StatusVisibility;
}

/**
 * Whether `viewerId` may see this specific status.
 *
 * SECURITY: this is the fix for the worst defect in the old feature. The old
 * helper returned `true` for `contacts_only` with the comment "Already filtered
 * at the query level in getStatusFeed" - but `viewStatus` called the same helper
 * directly on a status fetched by id alone. Any authenticated user could
 * therefore view, and register a view on, any `contacts_only` status belonging to
 * any stranger, simply by knowing its id. `except` was worse: it returned true
 * for anyone not named in the exclusion list, so a total stranger passed while
 * the owner's actual excluded contacts were blocked.
 *
 * Visibility is now decided here, per status, for both the feed and the view
 * path. There is no caller-supplied assumption left to be wrong.
 */
async function isVisibleTo(viewerId: string, status: VisibilitySubject): Promise<boolean> {
  if (status.userId === viewerId) return true;

  if (status.visibility === "everyone") return true;
  if (status.visibility === "contacts_only") return areContacts(viewerId, status.userId);
  if (status.visibility === "selected") return hasVisibilityGrant(status.id, viewerId);
  if (status.visibility === "except") {
    // "Everyone except these people" still means everyone among my contacts.
    if (!(await areContacts(viewerId, status.userId))) return false;
    return !(await hasVisibilityGrant(status.id, viewerId));
  }
  return false;
}

// ─── Create ─────────────────────────────────────────────────────────────────

export interface CreateStatusResult {
  message: string;
  statusId: string;
  expiresAt: Date;
}

export async function createStatus(
  user: AuthenticatedUser,
  input: CreateStatusInput,
): Promise<CreateStatusResult> {
  if (isMissionaryLocked(user)) {
    throw forbidden("Missionaries cannot post statuses.");
  }

  const isText = input.media_type === StatusMediaType.text;
  const visibility = input.visibility ?? (await preferencesOf(user.id)).statusVisibilityDefault;
  const expiresAt = new Date(Date.now() + STATUS_LIFETIME_MS);

  const needsGrants = visibility === "selected" || visibility === "except";

  // Only ids that belong to real accounts, and never the author's own. Inserting
  // an unknown id would otherwise fail the whole request on a foreign key.
  let grantUserIds: string[] = [];
  if (needsGrants && input.visibility_user_ids.length > 0) {
    const candidates = [...new Set(input.visibility_user_ids)].filter((id) => id !== user.id);
    const known = await prisma.user.findMany({
      where: { id: { in: candidates } },
      select: { id: true },
    });
    grantUserIds = known.map((row) => row.id);

    if (visibility === "selected" && grantUserIds.length === 0) {
      throw badRequest("None of the selected users exist.");
    }
  }

  const status = await prisma.$transaction(async (tx) => {
    const created = await tx.status.create({
      data: {
        userId: user.id,
        mediaType: input.media_type,
        visibility,
        durationSecs: input.duration_secs,
        expiresAt,
        ...(input.media_url === undefined ? {} : { mediaUrl: input.media_url }),
        ...(input.caption === undefined ? {} : { caption: input.caption }),
        ...(isText && input.text_content !== undefined ? { textContent: input.text_content } : {}),
        // Omitted when absent so the column default (#0A1628) applies.
        ...(input.background_color === undefined
          ? {}
          : { backgroundColor: input.background_color }),
      },
      select: { id: true, expiresAt: true },
    });

    if (grantUserIds.length > 0) {
      await tx.statusVisibilityUser.createMany({
        data: grantUserIds.map((userId) => ({ statusId: created.id, userId })),
        skipDuplicates: true,
      });
    }

    return created;
  });

  return { message: "Status posted", statusId: status.id, expiresAt: status.expiresAt };
}

// ─── Feed ───────────────────────────────────────────────────────────────────

export interface FeedStatus {
  id: string;
  mediaUrl: string | null;
  mediaType: StatusMediaType;
  caption: string | null;
  textContent: string | null;
  backgroundColor: string;
  durationSecs: number;
  expiresAt: Date;
  createdAt: Date;
  viewed: boolean;
}

export interface FeedEntry {
  userId: string;
  authorName: string;
  authorPhoto: string | null;
  authorRole: LeadershipRole;
  allViewed: boolean;
  statuses: FeedStatus[];
}

/**
 * Active statuses from the viewer's contacts, grouped by author.
 *
 * Note what is gone: the old query granted `it_support` a bypass of the entire
 * contact filter, so that role could read every private status on the platform.
 * The new role model states that IT support has to be named in a route's
 * allowlist like anybody else, and reading strangers' ephemeral posts has no
 * operational justification. The bypass is not reproduced.
 *
 * Also gone: the feed used to compute a `view_count` per status and hand it to
 * whoever was reading the feed, which published one user's audience size to
 * another. View counts belong to the owner, and now only appear on /mine and
 * /:id/viewers.
 */
export async function getFeed(viewerId: string): Promise<FeedEntry[]> {
  const contactIds = [...(await contactIdsOf(viewerId))];
  if (contactIds.length === 0) return [];

  const candidates = await prisma.status.findMany({
    where: { expiresAt: { gt: new Date() }, userId: { in: contactIds } },
    orderBy: [{ user: { fullName: "asc" } }, { createdAt: "asc" }],
    select: {
      ...STATUS_SELECT,
      userId: true,
      user: { select: { fullName: true, profilePhotoUrl: true, role: true } },
      views: { where: { viewerId }, select: { id: true }, take: 1 },
    },
  });

  if (candidates.length === 0) return [];

  // One query for every grant that concerns this viewer, rather than a query
  // per status inside the filter loop.
  const grants = await prisma.statusVisibilityUser.findMany({
    where: { userId: viewerId, statusId: { in: candidates.map((status) => status.id) } },
    select: { statusId: true },
  });
  const grantedStatusIds = new Set(grants.map((grant) => grant.statusId));

  const grouped = new Map<string, FeedEntry>();

  for (const status of candidates) {
    // Everyone in `candidates` is already a contact, so the only remaining
    // question is the per-status grant list.
    if (status.visibility === "selected" && !grantedStatusIds.has(status.id)) continue;
    if (status.visibility === "except" && grantedStatusIds.has(status.id)) continue;

    const viewed = status.views.length > 0;

    let entry = grouped.get(status.userId);
    if (!entry) {
      entry = {
        userId: status.userId,
        authorName: status.user.fullName,
        authorPhoto: status.user.profilePhotoUrl,
        authorRole: status.user.role,
        allViewed: true,
        statuses: [],
      };
      grouped.set(status.userId, entry);
    }

    if (!viewed) entry.allViewed = false;
    entry.statuses.push({
      id: status.id,
      mediaUrl: status.mediaUrl,
      mediaType: status.mediaType,
      caption: status.caption,
      textContent: status.textContent,
      backgroundColor: status.backgroundColor,
      durationSecs: status.durationSecs,
      expiresAt: status.expiresAt,
      createdAt: status.createdAt,
      viewed,
    });
  }

  // Authors with something unseen first, author order otherwise preserved.
  return [...grouped.values()].sort((a, b) => Number(a.allViewed) - Number(b.allViewed));
}

// ─── Own statuses ───────────────────────────────────────────────────────────

/**
 * The caller's own active statuses, with their audience.
 *
 * Stealth viewers are counted but never named. The old version issued two extra
 * queries per status inside a loop to work this out; it is one query now.
 */
export async function getMyStatuses(userId: string) {
  const statuses = await prisma.status.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: {
      ...STATUS_SELECT,
      views: {
        orderBy: { viewedAt: "desc" },
        select: {
          viewedAt: true,
          isStealth: true,
          viewer: { select: { id: true, fullName: true, profilePhotoUrl: true } },
        },
      },
    },
  });

  return statuses.map(({ views, ...status }) => {
    const visible = views.filter((view) => !view.isStealth);
    return {
      ...status,
      viewers: visible.map((view) => ({
        userId: view.viewer.id,
        fullName: view.viewer.fullName,
        profilePhotoUrl: view.viewer.profilePhotoUrl,
        viewedAt: view.viewedAt,
      })),
      viewCount: visible.length,
      stealthViewCount: views.length - visible.length,
    };
  });
}

// ─── View ───────────────────────────────────────────────────────────────────

export interface ViewStatusResult {
  message: string;
  stealth: boolean;
  recorded: boolean;
}

export async function viewStatus(
  viewer: AuthenticatedUser,
  statusId: string,
  stealthOverride: boolean | undefined,
): Promise<ViewStatusResult> {
  const status = await prisma.status.findFirst({
    where: { id: statusId, expiresAt: { gt: new Date() } },
    select: { id: true, userId: true, visibility: true },
  });
  if (!status) throw notFound("Status not found or has expired");

  if (!(await isVisibleTo(viewer.id, status))) {
    throw forbidden("You are not allowed to view this status");
  }

  // The owner opening their own status is not a view. Recording it put the
  // author at the top of their own viewer list and inflated their own count.
  if (status.userId === viewer.id) {
    return { message: "Own status, not recorded as a view", stealth: false, recorded: false };
  }

  const stealth = stealthOverride ?? (await preferencesOf(viewer.id)).stealthStatusView;

  await prisma.statusView.upsert({
    where: { statusId_viewerId: { statusId: status.id, viewerId: viewer.id } },
    create: { statusId: status.id, viewerId: viewer.id, isStealth: stealth },
    update: { viewedAt: new Date(), isStealth: stealth },
  });

  return {
    message: stealth ? "Viewed anonymously" : "View recorded",
    stealth,
    recorded: true,
  };
}

// ─── Viewers ────────────────────────────────────────────────────────────────

/**
 * The audience for one status. Owner only.
 *
 * Stealth viewers are returned as a count. Naming them would defeat the point of
 * the setting.
 */
export async function getStatusViewers(ownerId: string, statusId: string) {
  const status = await prisma.status.findUnique({
    where: { id: statusId },
    select: { id: true, userId: true },
  });
  if (!status) throw notFound("Status not found");
  if (status.userId !== ownerId) throw forbidden("Only the status owner can see viewers");

  const views = await prisma.statusView.findMany({
    where: { statusId },
    orderBy: { viewedAt: "desc" },
    select: {
      viewedAt: true,
      isStealth: true,
      viewer: { select: { id: true, fullName: true, profilePhotoUrl: true } },
    },
  });

  const visible = views.filter((view) => !view.isStealth);

  return {
    viewers: visible.map((view) => ({
      userId: view.viewer.id,
      fullName: view.viewer.fullName,
      profilePhotoUrl: view.viewer.profilePhotoUrl,
      viewedAt: view.viewedAt,
    })),
    viewCount: visible.length,
    stealthCount: views.length - visible.length,
    totalViews: views.length,
  };
}

// ─── Delete ─────────────────────────────────────────────────────────────────

/** Deletes one of the caller's own statuses. Ownership is part of the filter. */
export async function deleteStatus(ownerId: string, statusId: string): Promise<void> {
  const deleted = await prisma.status.deleteMany({ where: { id: statusId, userId: ownerId } });
  if (deleted.count === 0) throw notFound("Status not found");
}

// ─── Settings ───────────────────────────────────────────────────────────────

export async function updateStatusSettings(
  userId: string,
  input: StatusSettingsInput,
): Promise<{ stealthStatusView: boolean; statusVisibilityDefault: StatusVisibility }> {
  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.stealth_status_view === undefined
        ? {}
        : { stealthStatusView: input.stealth_status_view }),
      ...(input.status_visibility_default === undefined
        ? {}
        : { statusVisibilityDefault: input.status_visibility_default }),
    },
    select: { stealthStatusView: true, statusVisibilityDefault: true },
  });
  return updated;
}
