import { isHiddenRole, tierOf } from "../../domain/roles";
import type { LeadershipRole, UserStatus } from "../../generated/prisma/enums";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { badRequest, forbidden, notFound } from "../../middleware/errorHandler";
import type { CreateGroupInput, UpdateGroupInput } from "./schemas";

/**
 * Group administration.
 *
 * The headline fix in here: `POST /groups/:id/members` performed no membership
 * check and no admin check whatsoever. Any approved account could add arbitrary
 * users to any group by id, including leadership groups, and could add itself.
 * Adding members now requires being a current admin of that group.
 */

// ─── Access control ─────────────────────────────────────────────────────────
// The invitee rules are duplicated from the conversations feature on purpose:
// feature modules do not import from each other, and both surfaces can create a
// group. Keep the two in step.

interface GroupParty {
  id: string;
  role: LeadershipRole;
  status: UserStatus;
  missionId: string | null;
  missionaryModeActive: boolean;
}

const INVITEE_SELECT = {
  id: true,
  role: true,
  status: true,
  isApproved: true,
  missionId: true,
  missionaryModeActive: true,
} as const;

function isMissionaryLocked(user: GroupParty): boolean {
  return user.missionaryModeActive || user.status === "missionary" || user.role === "missionary";
}

/** Same mission, where "neither has one" does not count as a match. */
function sameMission(left: string | null, right: string | null): boolean {
  return left !== null && left === right;
}

/**
 * A missionary belongs only to groups for their own mission, and a senior leader
 * cannot be pulled into a group by someone not allowed to see them. The old code
 * imported `canJoinGroup` and then never called it.
 */
function assertMayAddToGroup(
  actor: GroupParty,
  invitee: GroupParty & { isApproved: boolean },
  conversation: { missionId: string | null },
): void {
  if (!invitee.isApproved) {
    throw forbidden("One of those members cannot be added to a group yet.");
  }
  if (isMissionaryLocked(invitee) && !sameMission(conversation.missionId, invitee.missionId)) {
    throw forbidden("A missionary can only be added to a group for their own mission.");
  }
  if (isHiddenRole(invitee.role) && tierOf(actor.role) < tierOf(invitee.role)) {
    throw forbidden("You cannot add that member to a group.");
  }
}

// ─── Membership guards ──────────────────────────────────────────────────────

interface GroupRow {
  id: string;
  missionId: string | null;
  maxMembers: number;
}

async function requireGroup(groupId: string): Promise<GroupRow> {
  const group = await prisma.conversation.findFirst({
    where: { id: groupId, isGroup: true },
    select: { id: true, missionId: true, maxMembers: true },
  });
  if (!group) throw notFound("Group not found");
  return group;
}

/**
 * Confirms the caller is a current member. `leftAt` is part of every check here:
 * the old admin lookups omitted it, so a former admin who had left the group
 * kept the ability to remove members and change roles.
 */
async function requireGroupMembership(groupId: string, userId: string): Promise<{ isAdmin: boolean }> {
  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: groupId, userId } },
    select: { isAdmin: true, leftAt: true },
  });
  if (!membership || membership.leftAt !== null) {
    throw forbidden("Not a member of this group");
  }
  return { isAdmin: membership.isAdmin };
}

async function requireGroupAdmin(groupId: string, userId: string, action: string): Promise<void> {
  const membership = await requireGroupMembership(groupId, userId);
  if (!membership.isAdmin) throw forbidden(`Only group admins can ${action}`);
}

// ─── Creation ───────────────────────────────────────────────────────────────

export interface GroupCreated {
  id: string;
  name: string | null;
  description: string | null;
  photoUrl: string | null;
  missionId: string | null;
  isGroup: true;
  isAdmin: true;
  createdAt: Date;
  memberCount: number;
}

export async function createGroup(user: GroupParty, input: CreateGroupInput): Promise<GroupCreated> {
  const missionId = input.mission_id ?? null;
  const inviteeIds = input.member_ids.filter((id) => id !== user.id);

  if (isMissionaryLocked(user) && !missionId) {
    throw forbidden("Missionaries can only create mission-scoped groups");
  }

  if (inviteeIds.length > 0) {
    const invitees = await prisma.user.findMany({
      where: { id: { in: inviteeIds } },
      select: INVITEE_SELECT,
    });
    if (invitees.length !== inviteeIds.length) {
      throw badRequest("One or more of those members do not exist");
    }
    for (const invitee of invitees) {
      assertMayAddToGroup(user, invitee, { missionId });
    }
  }

  // The conversation and all of its members are written together. The old loop
  // inserted them one statement at a time with no transaction, so a failure
  // mid-way produced a group missing an arbitrary suffix of its members.
  const group = await prisma.conversation.create({
    data: {
      name: input.name,
      description: input.description ?? null,
      photoUrl: input.photo_url ?? null,
      isGroup: true,
      missionId,
      createdById: user.id,
      members: {
        create: [
          { userId: user.id, isAdmin: true },
          ...inviteeIds.map((userId) => ({ userId, isAdmin: false })),
        ],
      },
    },
    select: {
      id: true,
      name: true,
      description: true,
      photoUrl: true,
      missionId: true,
      createdAt: true,
    },
  });

  logger.info("group created", { conversationId: group.id, memberCount: inviteeIds.length + 1 });

  // INTEGRATION: notify the invitees, once the notifications feature exposes a
  // service to call.
  return { ...group, isGroup: true, isAdmin: true, memberCount: inviteeIds.length + 1 };
}

// ─── Reading ────────────────────────────────────────────────────────────────

export interface GroupMemberView {
  id: string;
  fullName: string;
  profilePhotoUrl: string | null;
  role: LeadershipRole;
  phoneNumber: string;
  isAdmin: boolean;
  joinedAt: Date;
}

export interface GroupInfo {
  id: string;
  name: string | null;
  description: string | null;
  photoUrl: string | null;
  missionId: string | null;
  onlyAdminsCanMessage: boolean;
  onlyAdminsCanEdit: boolean;
  createdAt: Date;
  isAdmin: boolean;
  memberCount: number;
  members: GroupMemberView[];
}

export async function getGroupInfo(groupId: string, userId: string): Promise<GroupInfo> {
  const membership = await requireGroupMembership(groupId, userId);

  const group = await prisma.conversation.findFirst({
    where: { id: groupId, isGroup: true },
    select: {
      id: true,
      name: true,
      description: true,
      photoUrl: true,
      missionId: true,
      onlyAdminsCanMessage: true,
      onlyAdminsCanEdit: true,
      createdAt: true,
      members: {
        where: { leftAt: null },
        orderBy: [{ isAdmin: "desc" }, { user: { fullName: "asc" } }],
        select: {
          isAdmin: true,
          joinedAt: true,
          user: {
            select: {
              id: true,
              fullName: true,
              profilePhotoUrl: true,
              role: true,
              phoneNumber: true,
            },
          },
        },
      },
    },
  });
  if (!group) throw notFound("Group not found");

  const { members, ...rest } = group;
  return {
    ...rest,
    isAdmin: membership.isAdmin,
    memberCount: members.length,
    members: members.map((member) => ({
      ...member.user,
      isAdmin: member.isAdmin,
      joinedAt: member.joinedAt,
    })),
  };
}

// ─── Settings ───────────────────────────────────────────────────────────────

export async function updateGroup(
  groupId: string,
  userId: string,
  input: UpdateGroupInput,
): Promise<{ message: string }> {
  await requireGroup(groupId);
  await requireGroupAdmin(groupId, userId, "edit group settings");

  // Prisma skips `undefined` fields, so an omitted field is left alone while an
  // explicit `null` clears it.
  await prisma.conversation.update({
    where: { id: groupId },
    data: {
      name: input.name,
      description: input.description,
      photoUrl: input.photo_url,
      onlyAdminsCanMessage: input.only_admins_can_message,
      onlyAdminsCanEdit: input.only_admins_can_edit,
    },
  });

  return { message: "Group updated" };
}

// ─── Members ────────────────────────────────────────────────────────────────

export interface AddMembersResult {
  message: string;
  added: number;
}

export async function addMembers(
  actor: GroupParty,
  groupId: string,
  requestedIds: string[],
): Promise<AddMembersResult> {
  const group = await requireGroup(groupId);
  // The check the old handler was missing entirely.
  await requireGroupAdmin(groupId, actor.id, "add members");

  const inviteeIds = requestedIds.filter((id) => id !== actor.id);
  if (inviteeIds.length === 0) throw badRequest("You are already a member of this group");

  const invitees = await prisma.user.findMany({
    where: { id: { in: inviteeIds } },
    select: INVITEE_SELECT,
  });
  if (invitees.length !== inviteeIds.length) {
    throw badRequest("One or more of those members do not exist");
  }
  for (const invitee of invitees) {
    assertMayAddToGroup(actor, invitee, group);
  }

  const [currentCount, existing] = await Promise.all([
    prisma.conversationMember.count({ where: { conversationId: groupId, leftAt: null } }),
    prisma.conversationMember.findMany({
      where: { conversationId: groupId, userId: { in: inviteeIds } },
      select: { userId: true, leftAt: true },
    }),
  ]);

  const known = new Set(existing.map((row) => row.userId));
  // Someone who left keeps their row. The old `ON CONFLICT DO NOTHING` therefore
  // made leaving a group permanent: they could never be added back.
  const rejoining = existing.filter((row) => row.leftAt !== null).map((row) => row.userId);
  const fresh = inviteeIds.filter((id) => !known.has(id));
  const added = fresh.length + rejoining.length;

  if (added === 0) return { message: "0 members added", added: 0 };

  if (currentCount + added > group.maxMembers) {
    throw badRequest(
      `Adding ${added} member${added === 1 ? "" : "s"} would exceed the ${group.maxMembers} member limit`,
    );
  }

  await prisma.$transaction([
    ...(rejoining.length > 0
      ? [
          prisma.conversationMember.updateMany({
            where: { conversationId: groupId, userId: { in: rejoining } },
            data: { leftAt: null, joinedAt: new Date(), isAdmin: false },
          }),
        ]
      : []),
    ...(fresh.length > 0
      ? [
          prisma.conversationMember.createMany({
            data: fresh.map((userId) => ({ conversationId: groupId, userId, isAdmin: false })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);

  logger.info("group members added", { conversationId: groupId, added });

  // INTEGRATION: notify the added members, once the notifications feature
  // exposes a service to call.
  return { message: `${added} member${added === 1 ? "" : "s"} added`, added };
}

export async function removeMember(
  groupId: string,
  actorId: string,
  targetUserId: string,
): Promise<{ message: string }> {
  await requireGroup(groupId);
  const isSelf = targetUserId === actorId;

  // Leaving requires being in the group; removing someone else requires being an
  // admin of it. Both checks previously ignored `left_at`.
  if (isSelf) {
    await requireGroupMembership(groupId, actorId);
  } else {
    await requireGroupAdmin(groupId, actorId, "remove other members");
  }

  // Known gap, carried over from the old handler: the last admin may still leave,
  // which leaves the group with no one able to administer it. Fixing that needs a
  // succession rule, which is a product decision rather than a port.
  const removed = await prisma.conversationMember.updateMany({
    where: { conversationId: groupId, userId: targetUserId, leftAt: null },
    data: { leftAt: new Date(), isAdmin: false },
  });
  if (removed.count === 0) throw notFound("That member is not in this group");

  return { message: isSelf ? "You left the group" : "Member removed" };
}

export async function setMemberAdmin(
  groupId: string,
  actorId: string,
  targetUserId: string,
  isAdmin: boolean,
): Promise<{ message: string }> {
  await requireGroup(groupId);
  await requireGroupAdmin(groupId, actorId, "promote or demote members");

  if (!isAdmin) {
    // A group with no admin can never be administered again, and nothing in the
    // old code stopped the last admin from demoting themselves.
    const otherAdmins = await prisma.conversationMember.count({
      where: { conversationId: groupId, leftAt: null, isAdmin: true, userId: { not: targetUserId } },
    });
    if (otherAdmins === 0) throw badRequest("A group must keep at least one admin");
  }

  const updated = await prisma.conversationMember.updateMany({
    where: { conversationId: groupId, userId: targetUserId, leftAt: null },
    data: { isAdmin },
  });
  if (updated.count === 0) throw notFound("That member is not in this group");

  return { message: isAdmin ? "Member promoted to admin" : "Admin role removed" };
}
