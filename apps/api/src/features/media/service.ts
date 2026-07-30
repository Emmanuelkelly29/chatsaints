import { stat } from "node:fs/promises";

import type { StatusVisibility } from "../../generated/prisma/enums";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { notFound } from "../../middleware/errorHandler";
import { resolveStoredPath, serveContentTypeFor } from "./storage";

/**
 * AUTHENTICATED MEDIA ACCESS
 *
 * The old application mounted `express.static('/uploads')` in app.js above every
 * router, with no authentication of any kind. Every voice note, photo, video and
 * document ever uploaded was readable by anyone who had the URL, with no token,
 * no session and no conversation membership. nginx then added
 * `Cache-Control: public, immutable` on top, so those files were also cached by
 * every intermediary between the server and the world. Since filenames were
 * UUIDs, the only thing protecting a private voice note was that nobody had
 * pasted the link anywhere. That mount is gone.
 *
 * A file is served only if the caller satisfies one of three conditions:
 *
 *   1. They uploaded it. Derived from the reference: files live under
 *      `<uploaderId>/`, so the uploader is part of the path.
 *   2. It is attached to a Message in a conversation they are currently a member
 *      of (`ConversationMember.leftAt IS NULL`). Leaving a group ends access to
 *      its media.
 *   3. It is attached to a Status they are allowed to view, evaluated against
 *      that status's own visibility rules and expiry.
 *
 * When none of those hold the response is 404, not 403. A 403 would confirm the
 * file exists, which is enough to tell an attacker that a reference they guessed
 * or found in a log is real.
 */

/** Reference form stored in `Message.mediaUrl` / `Status.mediaUrl`. */
function referenceFor(ownerId: string, fileName: string): string {
  return `${ownerId}/${fileName}`;
}

/**
 * Matches a stored reference regardless of the URL prefix in front of it.
 *
 * A reference contains two UUIDs, so it is unique across the deployment and
 * `endsWith` cannot collide with a different file. This tolerates the prefix
 * changing (`/api/media/file/...` today) without a data migration.
 */
function mediaUrlMatches(reference: string) {
  return { endsWith: reference };
}

async function attachedToVisibleMessage(viewerId: string, reference: string): Promise<boolean> {
  const message = await prisma.message.findFirst({
    where: {
      mediaUrl: mediaUrlMatches(reference),
      isDeleted: false,
      conversation: { members: { some: { userId: viewerId, leftAt: null } } },
    },
    select: { id: true },
  });
  return message !== null;
}

async function areConnected(viewerId: string, ownerId: string): Promise<boolean> {
  const userLowId = viewerId < ownerId ? viewerId : ownerId;
  const userHighId = viewerId < ownerId ? ownerId : viewerId;

  const connection = await prisma.contactConnection.findUnique({
    where: { userLowId_userHighId: { userLowId, userHighId } },
    select: { id: true },
  });
  return connection !== null;
}

async function isNamedInVisibilityList(statusId: string, viewerId: string): Promise<boolean> {
  const grant = await prisma.statusVisibilityUser.findUnique({
    where: { statusId_userId: { statusId, userId: viewerId } },
    select: { id: true },
  });
  return grant !== null;
}

/**
 * Whether a viewer may see a status, by its own rules.
 *
 * `selected` is an allowlist and `except` is a blocklist, both held in
 * `StatusVisibilityUser`. `contacts_only` requires an accepted connection: the
 * old direct-view helper returned true for `contacts_only` unconditionally, with
 * a comment saying it was "already filtered at the query level in
 * getStatusFeed", which was true of the feed and not of anything else that
 * called it.
 */
async function canViewStatus(
  viewerId: string,
  status: { id: string; userId: string; visibility: StatusVisibility; expiresAt: Date },
): Promise<boolean> {
  if (status.userId === viewerId) return true;

  // An expired status is no longer viewable by anyone but its owner, whatever
  // its visibility says.
  if (status.expiresAt.getTime() <= Date.now()) return false;

  switch (status.visibility) {
    case "everyone":
      return true;
    case "contacts_only":
      return areConnected(viewerId, status.userId);
    case "selected":
      return isNamedInVisibilityList(status.id, viewerId);
    case "except":
      return !(await isNamedInVisibilityList(status.id, viewerId));
    default:
      // Unreachable while StatusVisibility is exhaustive. Fail closed anyway.
      return false;
  }
}

async function attachedToVisibleStatus(viewerId: string, reference: string): Promise<boolean> {
  const status = await prisma.status.findFirst({
    where: { mediaUrl: mediaUrlMatches(reference) },
    select: { id: true, userId: true, visibility: true, expiresAt: true },
  });
  if (!status) return false;
  return canViewStatus(viewerId, status);
}

export interface ResolvedFile {
  absolutePath: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

/**
 * Authorizes the caller for a stored file and resolves it on disk.
 *
 * Every failure below is a 404. Ordering is cheapest-first: the ownership check
 * costs nothing, the message check is one indexed query, and the status check
 * only runs when the first two miss.
 */
export async function authorizeFileAccess(
  viewerId: string,
  ownerId: string,
  fileName: string,
): Promise<ResolvedFile> {
  const contentType = serveContentTypeFor(fileName);
  if (!contentType) throw notFound("File not found");

  const absolutePath = resolveStoredPath(ownerId, fileName);
  if (!absolutePath) throw notFound("File not found");

  if (viewerId !== ownerId) {
    const reference = referenceFor(ownerId, fileName);
    const permitted =
      (await attachedToVisibleMessage(viewerId, reference)) ||
      (await attachedToVisibleStatus(viewerId, reference));

    if (!permitted) {
      // Worth a log line: a burst of these from one account is somebody walking
      // references they were given but are no longer entitled to.
      logger.warn("media access denied", { viewerId, ownerId });
      throw notFound("File not found");
    }
  }

  const stats = await stat(absolutePath).catch(() => null);
  if (!stats?.isFile()) throw notFound("File not found");

  return { absolutePath, fileName, contentType, sizeBytes: stats.size };
}

export interface UploadResult {
  url: string;
  reference: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

/**
 * The record of an accepted upload.
 *
 * `url` is what belongs in `Message.mediaUrl` or `Status.mediaUrl`. It is an API
 * path, not a static one, and it resolves only through the authorization above.
 *
 * `contentType` is the type this server will serve the file as, which is not
 * necessarily the type the client declared. Callers should trust this one.
 */
export function describeUpload(ownerId: string, file: Express.Multer.File): UploadResult {
  const reference = referenceFor(ownerId, file.filename);
  return {
    url: `/api/media/file/${reference}`,
    reference,
    fileName: file.filename,
    contentType: serveContentTypeFor(file.filename) ?? "application/octet-stream",
    sizeBytes: file.size,
  };
}
