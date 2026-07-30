import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { conflict, notFound } from "../../middleware/errorHandler";
import type {
  NotificationSettingsInput,
  PrivacySettingsInput,
  ProfileSettingsInput,
} from "./schemas";

// ─── GET /settings ─────────────────────────────────────────────────────────

/**
 * The caller's own settings.
 *
 * The push tokens themselves are never returned, only whether one is
 * registered, which is what the old `fcm_token IS NOT NULL AS has_push_token`
 * expression was for. A token is a capability to send that device
 * notifications, so it is write-only from the client's point of view.
 */
export async function getSettings(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      stealthStatusView: true,
      statusVisibilityDefault: true,
      contactRequestPreference: true,
      directoryVisible: true,
      profileHidden: true,
      email: true,
      emailVerified: true,
      isSingle: true,
      dateOfBirth: true,
      fcmToken: true,
      apnsToken: true,
    },
  });

  // The old handler returned `{}` for a missing row, which let a client with a
  // valid token for a deleted account render an empty settings screen instead of
  // being told the account is gone.
  if (!user) throw notFound("User not found");

  return {
    stealthStatusView: user.stealthStatusView,
    statusVisibilityDefault: user.statusVisibilityDefault,
    contactRequestPreference: user.contactRequestPreference,
    directoryVisible: user.directoryVisible,
    profileHidden: user.profileHidden,
    email: user.email,
    emailVerified: user.emailVerified,
    isSingle: user.isSingle,
    dateOfBirth: user.dateOfBirth,
    hasPushToken: user.fcmToken !== null || user.apnsToken !== null,
    hasFcmToken: user.fcmToken !== null,
    hasApnsToken: user.apnsToken !== null,
  };
}

// ─── PATCH /settings/notifications ─────────────────────────────────────────

export async function updateNotificationSettings(
  userId: string,
  input: NotificationSettingsInput,
): Promise<{ message: string }> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      // `undefined` leaves the column alone, `null` clears it. That distinction
      // is the whole reason this is not a COALESCE any more.
      ...(input.fcm_token !== undefined ? { fcmToken: input.fcm_token } : {}),
      ...(input.apns_token !== undefined ? { apnsToken: input.apns_token } : {}),
    },
    select: { id: true },
  });

  logger.info("notification settings updated", { userId, fields: Object.keys(input) });
  return { message: "Notification settings updated" };
}

// ─── PATCH /settings/privacy ───────────────────────────────────────────────

/**
 * Privacy preferences.
 *
 * These columns were not merely unenforced, they were unread: the contact
 * request path selected neither `directory_visible` nor
 * `contact_request_preference`, then branched on both, so every comparison ran
 * against `undefined`. A user who chose "nobody" still received requests from
 * anyone. The authenticated-user select now loads both (see
 * middleware/auth.ts AUTH_USER_SELECT), and directory reads filter on them, so
 * what is written here takes effect.
 */
export async function updatePrivacySettings(
  userId: string,
  input: PrivacySettingsInput,
): Promise<{ message: string }> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.stealth_status_view !== undefined
        ? { stealthStatusView: input.stealth_status_view }
        : {}),
      ...(input.status_visibility_default !== undefined
        ? { statusVisibilityDefault: input.status_visibility_default }
        : {}),
      ...(input.is_single !== undefined ? { isSingle: input.is_single } : {}),
      ...(input.contact_request_preference !== undefined
        ? { contactRequestPreference: input.contact_request_preference }
        : {}),
      ...(input.directory_visible !== undefined
        ? { directoryVisible: input.directory_visible }
        : {}),
      ...(input.profile_hidden !== undefined ? { profileHidden: input.profile_hidden } : {}),
    },
    select: { id: true },
  });

  logger.info("privacy settings updated", { userId, fields: Object.keys(input) });
  return { message: "Privacy settings updated" };
}

// ─── PATCH /settings/profile ───────────────────────────────────────────────

export async function updateProfileSettings(userId: string, input: ProfileSettingsInput) {
  const current = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!current) throw notFound("User not found");

  // Both sides of this comparison are normalized: the schema lowercases and
  // trims on the way in, and every write path stores that same form.
  const emailChanged = input.email !== undefined && input.email !== current.email;

  if (emailChanged && input.email) {
    const taken = await prisma.user.findFirst({
      where: { email: input.email, id: { not: userId } },
      select: { id: true },
    });
    if (taken) throw conflict("That email address is already registered.");
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.full_name !== undefined ? { fullName: input.full_name } : {}),
      ...(input.bio !== undefined ? { bio: input.bio } : {}),
      ...(input.profile_photo_url !== undefined
        ? { profilePhotoUrl: input.profile_photo_url }
        : {}),
      // A changed address starts unverified. Keeping the old verified flag would
      // let someone claim an address they cannot receive mail at and keep every
      // privilege that verification gates.
      // INTEGRATION: the auth feature should issue and deliver a verification
      // code to the new address here, as registration does.
      ...(emailChanged ? { email: input.email ?? null, emailVerified: false } : {}),
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      emailVerified: true,
      bio: true,
      profilePhotoUrl: true,
    },
  });

  logger.info("profile settings updated", { userId, fields: Object.keys(input), emailChanged });

  return { message: "Profile updated", user: updated };
}

// ─── DELETE /settings/account ──────────────────────────────────────────────

/**
 * Permanent account deletion.
 *
 * The old implementation hand-deleted eight tables in sequence, outside a
 * transaction, and then deleted the user. It failed outright for anyone with
 * meeting, call, video-room, announcement, notification or E2EE-key history,
 * because those foreign keys had no ON DELETE behaviour, so the final statement
 * hit a constraint violation after the other eight deletes had already
 * committed. The account survived with most of its data destroyed.
 *
 * The schema now declares the intent per relation, so one delete is correct and
 * atomic:
 *
 *   Cascade  - pool memberships, conversation memberships, pinned conversations,
 *              message reads and reactions, call and meeting and video-room
 *              participation, meeting join requests, statuses and status views
 *              and visibility grants, leader approvals as applicant,
 *              announcement recipients, contact requests and connections,
 *              notifications, all E2EE keys and queued messages.
 *   SetNull  - authored messages, initiated calls, hosted meetings, created
 *              conversations and video rooms, sent announcements, approvals
 *              reviewed, pool members added, spouse and approved-by links.
 *
 * Message rows deliberately survive with a null sender rather than being
 * rewritten to "[Deleted account]" as the old code did. That column belongs to
 * every participant in the conversation, not only to the author, and destroying
 * their copy of the history is not this endpoint's decision to make.
 */
export async function deleteAccount(user: {
  id: string;
  role: string;
  missionaryModeActive: boolean;
}): Promise<{ message: string }> {
  // INTEGRATION: for a missionary or an account with missionary mode active,
  // the MDM device enrolment must be revoked before the row disappears, since
  // the unenrol call needs maas360DeviceId. The old handler called
  // services/maas360Service.unenrollMissionaryDevice(userId) here.
  const needsMdmUnenrol = user.missionaryModeActive || user.role === "missionary";

  // INTEGRATION: notify anyone with an open contact request from this account
  // that it went away, and drop the user's device tokens from the push
  // provider's registry.

  await prisma.user.delete({ where: { id: user.id } });

  logger.info("account deleted", { userId: user.id, needsMdmUnenrol });

  return { message: "Account permanently deleted. We are sorry to see you go." };
}
