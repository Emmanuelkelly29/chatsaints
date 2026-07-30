import { prisma } from "../../lib/prisma";
import { notFound } from "../../middleware/errorHandler";
import type { ReactionEmoji } from "./schemas";

/**
 * Message reactions.
 *
 * Access is checked on every operation, including reads. `GET .../reactions`
 * previously had no check whatsoever: any approved account could enumerate the
 * reactions, and therefore the full names of the people reacting, on any message
 * id in the database.
 */

export interface ReactionGroup {
  emoji: string;
  count: number;
  /** Up to `PREVIEW_LIMIT` reactors in the order they reacted. `count` is exact. */
  users: { id: string; fullName: string }[];
}

export interface ReactionSummary {
  messageId: string;
  reactions: ReactionGroup[];
}

/**
 * A large group can produce thousands of reaction rows for one message, so the
 * name list is capped while the counts stay exact.
 */
const PREVIEW_LIMIT = 200;

/**
 * A reaction is only visible to current members of the conversation the message
 * belongs to. Both failure modes answer 404 so the endpoint cannot be used to
 * probe for message ids.
 */
async function requireMessageAccess(messageId: string, userId: string): Promise<void> {
  const message = await prisma.message.findFirst({
    where: {
      id: messageId,
      isDeleted: false,
      conversation: { members: { some: { userId, leftAt: null } } },
    },
    select: { id: true },
  });
  if (!message) throw notFound("Message not found or access denied");
}

async function summarise(messageId: string): Promise<ReactionSummary> {
  const [counts, preview] = await Promise.all([
    prisma.messageReaction.groupBy({
      by: ["emoji"],
      where: { messageId },
      _count: { _all: true },
    }),
    prisma.messageReaction.findMany({
      where: { messageId },
      orderBy: { createdAt: "asc" },
      take: PREVIEW_LIMIT,
      select: { emoji: true, user: { select: { id: true, fullName: true } } },
    }),
  ]);

  const usersByEmoji = new Map<string, { id: string; fullName: string }[]>();
  for (const row of preview) {
    const bucket = usersByEmoji.get(row.emoji);
    if (bucket) {
      bucket.push(row.user);
    } else {
      usersByEmoji.set(row.emoji, [row.user]);
    }
  }

  const reactions = counts
    .map((row) => ({
      emoji: row.emoji,
      count: row._count._all,
      users: usersByEmoji.get(row.emoji) ?? [],
    }))
    .sort((left, right) => right.count - left.count || left.emoji.localeCompare(right.emoji));

  return { messageId, reactions };
}

export async function listReactions(messageId: string, userId: string): Promise<ReactionSummary> {
  await requireMessageAccess(messageId, userId);
  return summarise(messageId);
}

export async function addReaction(
  messageId: string,
  userId: string,
  emoji: ReactionEmoji,
): Promise<ReactionSummary> {
  await requireMessageAccess(messageId, userId);

  await prisma.messageReaction.createMany({
    data: [{ messageId, userId, emoji }],
    // Reacting twice with the same emoji is a no-op, not a conflict.
    skipDuplicates: true,
  });

  // INTEGRATION: notify the message author that someone reacted, once the
  // notifications feature exposes a service to call.
  return summarise(messageId);
}

export async function removeReaction(
  messageId: string,
  userId: string,
  emoji: ReactionEmoji,
): Promise<ReactionSummary> {
  await requireMessageAccess(messageId, userId);

  // Scoped to the caller's own reaction, so there is nothing to authorise beyond
  // access to the message.
  await prisma.messageReaction.deleteMany({ where: { messageId, userId, emoji } });

  return summarise(messageId);
}
