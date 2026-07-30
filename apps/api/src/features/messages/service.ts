import type { MessageType } from "../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import { forbidden, notFound } from "../../middleware/errorHandler";
import type { MessageListQuery } from "./schemas";

/**
 * Message reads and deletion.
 *
 * Messages themselves are written by the realtime path, so there is no create
 * endpoint here, only history and removal.
 */

export interface MessageSender {
  id: string;
  fullName: string;
  profilePhotoUrl: string | null;
}

export interface MessageView {
  id: string;
  conversationId: string;
  senderId: string | null;
  type: MessageType;
  content: string | null;
  mediaUrl: string | null;
  /**
   * A string, not a number: the column is a BigInt, which `JSON.stringify`
   * refuses to serialise. The old handler returned it as a string too, because
   * node-postgres renders bigint that way.
   */
  mediaSizeBytes: string | null;
  mediaDurationSecs: number | null;
  replyToId: string | null;
  isDeleted: boolean;
  createdAt: Date;
  /** Null when the author's account has been deleted. */
  sender: MessageSender | null;
  replyTo: { id: string; content: string | null; senderId: string | null } | null;
}

/**
 * Confirms the caller is a current member of the conversation.
 *
 * `leftAt` is part of the check. Without it, leaving a conversation left the
 * entire message history readable.
 */
async function requireMembership(conversationId: string, userId: string): Promise<void> {
  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    select: { leftAt: true },
  });
  if (!membership || membership.leftAt !== null) {
    throw forbidden("Not in this conversation");
  }
}

export async function listMessages(
  conversationId: string,
  userId: string,
  query: MessageListQuery,
): Promise<MessageView[]> {
  await requireMembership(conversationId, userId);

  const messages = await prisma.message.findMany({
    where: {
      conversationId,
      isDeleted: false,
      ...(query.before ? { createdAt: { lt: query.before } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: query.limit,
    select: {
      id: true,
      conversationId: true,
      senderId: true,
      type: true,
      content: true,
      mediaUrl: true,
      mediaSizeBytes: true,
      mediaDurationSecs: true,
      replyToId: true,
      isDeleted: true,
      createdAt: true,
      sender: { select: { id: true, fullName: true, profilePhotoUrl: true } },
      replyTo: { select: { id: true, content: true, senderId: true } },
    },
  });

  await markRead(messages, userId);

  return messages.reverse().map((message) => ({
    ...message,
    mediaSizeBytes: message.mediaSizeBytes === null ? null : message.mediaSizeBytes.toString(),
  }));
}

/**
 * Records read receipts for everything the caller just received.
 *
 * One statement. The old loop issued a separate INSERT per message, so a page of
 * 100 messages meant 100 round trips inside the read path of the busiest
 * endpoint in the application.
 */
async function markRead(
  messages: readonly { id: string; senderId: string | null }[],
  userId: string,
): Promise<void> {
  const unread = messages.filter((message) => message.senderId !== userId);
  if (unread.length === 0) return;

  await prisma.messageRead.createMany({
    data: unread.map((message) => ({ messageId: message.id, userId })),
    // Re-reading a page is normal, so an existing receipt is not an error.
    skipDuplicates: true,
  });
}

/**
 * Soft-deletes a message. Only the author may do so.
 *
 * A null `senderId` means the author's account is gone, and nobody inherits the
 * right to delete their messages.
 */
export async function deleteMessage(
  messageId: string,
  userId: string,
): Promise<{ message: string }> {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { senderId: true, isDeleted: true },
  });
  if (!message) throw notFound("Message not found");
  if (message.senderId === null || message.senderId !== userId) {
    throw forbidden("Not your message");
  }
  if (message.isDeleted) return { message: "Message deleted" };

  await prisma.message.update({
    where: { id: messageId },
    // The body goes with it. `mediaUrl` is deliberately kept: no read path
    // returns a deleted message, and storage cleanup needs the key to find the
    // file it has to remove.
    data: { isDeleted: true, content: null, deletedAt: new Date() },
  });

  return { message: "Message deleted" };
}
