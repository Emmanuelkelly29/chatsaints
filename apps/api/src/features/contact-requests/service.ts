import type { Prisma } from "../../generated/prisma/client";
import type { ContactRequestStatus, LeadershipRole } from "../../generated/prisma/enums";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import type { AuthenticatedUser } from "../../middleware/auth";
import { badRequest, conflict, forbidden, notFound } from "../../middleware/errorHandler";
import {
  canChat1on1,
  contactRequestEligibility,
  isReachableAccount,
  CONTACT_CANDIDATE_SELECT,
} from "../pool/visibility";
import type { CreateContactRequestInput } from "./schemas";

/**
 * Contact requests: the handshake that has to succeed before two people who are
 * not already connected can open a 1-on-1 conversation.
 *
 * The privacy settings this feature is built on were dead code. The recipient
 * was loaded by a helper that never selected `directory_visible` or
 * `contact_request_preference`, yet the handler branched on
 * `recipient.directory_visible === false` and passed
 * `recipient.contact_request_preference` into the permission check. Both were
 * always `undefined`, so the branch never fired and the check fell through to
 * its permissive default: someone who had chosen "nobody" still received
 * requests from anyone on the platform. Both fields are now selected, in
 * CONTACT_CANDIDATE_SELECT, and both are honoured.
 */

/**
 * Orders a pair of ids for the `contact_connections` unique row.
 *
 * The CHECK constraint is `user_low_id < user_high_id` on `uuid` columns, which
 * Postgres compares bytewise. Plain `<` on the canonical lowercase text matches
 * that ordering. The old code used `localeCompare`, whose collation is not
 * guaranteed to agree with the database and could therefore build a pair the
 * constraint rejects.
 */
function orderedPair(first: string, second: string): [string, string] {
  return first < second ? [first, second] : [second, first];
}

/** A declined request cannot be re-sent immediately. */
const DECLINE_COOLDOWN_DAYS = 30;

const REQUEST_PARTY_SELECT = {
  id: true,
  fullName: true,
  role: true,
  profilePhotoUrl: true,
  stake: { select: { name: true } },
  district: { select: { name: true } },
} as const;

interface RequestParty {
  id: string;
  fullName: string;
  role: LeadershipRole;
  profilePhotoUrl: string | null;
  stake: { name: string } | null;
  district: { name: string } | null;
}

export interface ContactRequestSummary {
  id: string;
  introMessage: string | null;
  createdAt: Date;
  userId: string;
  fullName: string;
  role: LeadershipRole;
  profilePhotoUrl: string | null;
  unitName: string | null;
}

function toSummary(
  row: { id: string; introMessage: string | null; createdAt: Date },
  party: RequestParty,
): ContactRequestSummary {
  return {
    id: row.id,
    introMessage: row.introMessage,
    createdAt: row.createdAt,
    userId: party.id,
    fullName: party.fullName,
    role: party.role,
    profilePhotoUrl: party.profilePhotoUrl,
    // A district is a peer of a stake, so either name may be the home unit.
    unitName: party.stake?.name ?? party.district?.name ?? null,
  };
}

export interface ContactRequestInbox {
  incoming: ContactRequestSummary[];
  outgoing: ContactRequestSummary[];
  incomingCount: number;
  outgoingCount: number;
}

export async function listContactRequests(user: AuthenticatedUser): Promise<ContactRequestInbox> {
  const [incoming, outgoing] = await Promise.all([
    prisma.contactRequest.findMany({
      where: { recipientId: user.id, status: "pending" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        introMessage: true,
        createdAt: true,
        sender: { select: REQUEST_PARTY_SELECT },
      },
    }),
    prisma.contactRequest.findMany({
      where: { senderId: user.id, status: "pending" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        introMessage: true,
        createdAt: true,
        recipient: { select: REQUEST_PARTY_SELECT },
      },
    }),
  ]);

  const incomingRows = incoming.map((row) => toSummary(row, row.sender));
  const outgoingRows = outgoing.map((row) => toSummary(row, row.recipient));

  return {
    incoming: incomingRows,
    outgoing: outgoingRows,
    incomingCount: incomingRows.length,
    outgoingCount: outgoingRows.length,
  };
}

// ─── Creating a request ─────────────────────────────────────────────────────

export type CreateContactRequestResult =
  | { status: "connected"; message: string }
  | { status: "incoming_pending"; message: string; requestId: string }
  | {
      status: "pending";
      message: string;
      request: { id: string; status: ContactRequestStatus; createdAt: Date };
    };

async function areConnected(first: string, second: string): Promise<boolean> {
  const [userLowId, userHighId] = orderedPair(first, second);
  const connection = await prisma.contactConnection.findUnique({
    where: { userLowId_userHighId: { userLowId, userHighId } },
    select: { id: true },
  });
  return connection !== null;
}

export async function createContactRequest(
  sender: AuthenticatedUser,
  input: CreateContactRequestInput,
): Promise<CreateContactRequestResult> {
  if (input.target_user_id === sender.id) {
    throw badRequest("You cannot send a connection request to yourself.");
  }

  const recipient = await prisma.user.findUnique({
    where: { id: input.target_user_id },
    select: CONTACT_CANDIDATE_SELECT,
  });

  // Reported identically to a hidden account below, so a missing id and a hidden
  // one are indistinguishable.
  if (!recipient) throw notFound("User not found");

  const eligibility = contactRequestEligibility(sender, recipient);
  if (!eligibility.ok) {
    switch (eligibility.reason) {
      case "self":
        throw badRequest("You cannot send a connection request to yourself.");
      case "hidden":
        // Never confirm that a hidden, unapproved or inactive account exists.
        throw notFound("User not found");
      case "unreachable":
        throw forbidden("You cannot connect with this user.");
      case "preference":
        throw forbidden("This user is not accepting connection requests from you.");
    }
  }

  if (await areConnected(sender.id, recipient.id)) {
    return { status: "connected", message: "You are already connected." };
  }

  const [reverse, existing] = await Promise.all([
    prisma.contactRequest.findUnique({
      where: { senderId_recipientId: { senderId: recipient.id, recipientId: sender.id } },
      select: { id: true, status: true },
    }),
    prisma.contactRequest.findUnique({
      where: { senderId_recipientId: { senderId: sender.id, recipientId: recipient.id } },
      select: { id: true, status: true, respondedAt: true },
    }),
  ]);

  if (reverse?.status === "pending") {
    return {
      status: "incoming_pending",
      message: "This user has already sent you a request. Accept it from your requests inbox.",
      requestId: reverse.id,
    };
  }

  /**
   * A decline holds for a while. The old handler reset any existing row straight
   * back to `pending`, so a declined request could be re-sent immediately and
   * indefinitely.
   */
  if (existing?.status === "declined" && existing.respondedAt) {
    const cooldownEnds = new Date(existing.respondedAt);
    cooldownEnds.setUTCDate(cooldownEnds.getUTCDate() + DECLINE_COOLDOWN_DAYS);
    if (cooldownEnds > new Date()) {
      throw conflict("This person declined a recent request. You can try again later.");
    }
  }

  const request = await prisma.contactRequest.upsert({
    where: { senderId_recipientId: { senderId: sender.id, recipientId: recipient.id } },
    create: {
      senderId: sender.id,
      recipientId: recipient.id,
      introMessage: input.intro_message,
    },
    update: {
      introMessage: input.intro_message,
      status: "pending",
      createdAt: new Date(),
      respondedAt: null,
      conversationId: null,
    },
    select: { id: true, status: true, createdAt: true },
  });

  logger.info("contact request sent", { requestId: request.id, senderId: sender.id });
  // INTEGRATION: notify the recipient of a new connection request.

  return { status: "pending", message: "Connection request sent", request };
}

// ─── Accepting a request ────────────────────────────────────────────────────

/**
 * INTEGRATION: 1-on-1 conversation creation belongs to the conversations
 * feature. These two helpers exist so accepting a request stays atomic without
 * reaching across feature boundaries; fold them into that feature's service
 * once it lands, and call it from inside this transaction.
 */
async function findExisting1on1(
  tx: Prisma.TransactionClient,
  userId: string,
  otherUserId: string,
): Promise<string | null> {
  const conversation = await tx.conversation.findFirst({
    where: {
      isGroup: false,
      AND: [
        { members: { some: { userId, leftAt: null } } },
        { members: { some: { userId: otherUserId, leftAt: null } } },
      ],
    },
    select: { id: true },
  });
  return conversation?.id ?? null;
}

async function create1on1(
  tx: Prisma.TransactionClient,
  userId: string,
  otherUserId: string,
): Promise<string> {
  const conversation = await tx.conversation.create({
    data: {
      isGroup: false,
      createdById: userId,
      members: {
        create: [
          { userId, isAdmin: true },
          { userId: otherUserId, isAdmin: false },
        ],
      },
    },
    select: { id: true },
  });
  return conversation.id;
}

export interface AcceptedConversation {
  id: string;
  name: string;
  isGroup: false;
  photoUrl: string | null;
  role: LeadershipRole;
  memberCount: number;
}

export async function acceptContactRequest(
  user: AuthenticatedUser,
  requestId: string,
): Promise<AcceptedConversation> {
  const request = await prisma.contactRequest.findFirst({
    where: { id: requestId, recipientId: user.id },
    select: { id: true, senderId: true, status: true },
  });
  if (!request) throw notFound("Request not found");
  if (request.status !== "pending") throw badRequest("This request is no longer pending.");

  const sender = await prisma.user.findUnique({
    where: { id: request.senderId },
    select: { ...CONTACT_CANDIDATE_SELECT, fullName: true, profilePhotoUrl: true },
  });

  // The sender's own preference is deliberately not consulted here: they asked.
  // What still has to hold is that the two may chat at all, and that the sender's
  // account is still in use.
  if (!sender || !isReachableAccount(sender.status) || !canChat1on1(sender, user)) {
    throw forbidden("This request can no longer be accepted.");
  }

  const [userLowId, userHighId] = orderedPair(user.id, sender.id);

  const conversationId = await prisma.$transaction(async (tx) => {
    await tx.contactConnection.upsert({
      where: { userLowId_userHighId: { userLowId, userHighId } },
      create: { userLowId, userHighId, requestId: request.id },
      update: {},
    });

    const existing = await findExisting1on1(tx, user.id, sender.id);
    const id = existing ?? (await create1on1(tx, user.id, sender.id));

    await tx.contactRequest.update({
      where: { id: request.id },
      data: { status: "accepted", respondedAt: new Date(), conversationId: id },
    });

    // Opening message, so the sender sees the acceptance in the thread itself.
    await tx.message.create({
      data: {
        conversationId: id,
        senderId: user.id,
        type: "text",
        content: `${user.fullName} accepted your connection request. You can now chat.`,
      },
    });

    return id;
  });

  logger.info("contact request accepted", {
    requestId: request.id,
    recipientId: user.id,
    conversationId,
  });
  // INTEGRATION: notify the sender that their request was accepted.

  return {
    id: conversationId,
    name: sender.fullName,
    isGroup: false,
    photoUrl: sender.profilePhotoUrl,
    role: sender.role,
    memberCount: 2,
  };
}

// ─── Declining a request ────────────────────────────────────────────────────

export async function declineContactRequest(
  user: AuthenticatedUser,
  requestId: string,
): Promise<void> {
  // Scoped to the recipient and to `pending` in one statement, so a request that
  // belongs to somebody else is indistinguishable from one that does not exist.
  const result = await prisma.contactRequest.updateMany({
    where: { id: requestId, recipientId: user.id, status: "pending" },
    data: { status: "declined", respondedAt: new Date() },
  });

  if (result.count === 0) throw notFound("Request not found");

  logger.info("contact request declined", { requestId, recipientId: user.id });
}
