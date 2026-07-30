import { prisma } from "../lib/prisma";
import type { OutboundMessage } from "./protocol";
import { broadcastToUsers } from "./registry";

/**
 * Group delivery. Recipient lists always come from the database, never from the
 * frame, so a sender cannot choose who hears them.
 */

export async function conversationMemberIds(conversationId: string): Promise<string[]> {
  const members = await prisma.conversationMember.findMany({
    where: { conversationId, leftAt: null },
    select: { userId: true },
  });
  return members.map((member) => member.userId);
}

export async function broadcastToConversation(
  conversationId: string,
  data: OutboundMessage,
  excludeUserId?: string,
): Promise<void> {
  broadcastToUsers(await conversationMemberIds(conversationId), data, excludeUserId);
}

export interface MeetingAudienceOptions {
  /** Include participants who have already left. Used when a meeting ends. */
  includeLeft?: boolean;
}

export async function meetingParticipantIds(
  meetingId: string,
  options: MeetingAudienceOptions = {},
): Promise<string[]> {
  const participants = await prisma.meetingParticipant.findMany({
    where: { meetingId, ...(options.includeLeft ? {} : { leftAt: null }) },
    select: { userId: true },
  });
  return participants.map((participant) => participant.userId);
}

export async function broadcastToMeeting(
  meetingId: string,
  data: OutboundMessage,
  options: MeetingAudienceOptions & { excludeUserId?: string } = {},
): Promise<void> {
  const audience = await meetingParticipantIds(meetingId, options);
  broadcastToUsers(audience, data, options.excludeUserId);
}
