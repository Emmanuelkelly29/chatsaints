import { z } from "zod";

import { env, isMaas360Configured } from "../../config/env";
import { describeError, logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";

/**
 * IBM MaaS360 mobile device management.
 *
 * The rule this module exists to enforce: never report success for work that did
 * not happen. The old service returned `{ success: true, mock: true }` when
 * MAAS360_TENANT_ID was absent, wrote `maas360_enrolled = true` with a
 * `DEV-MOCK-…` device id, and the controller then told a mission president the
 * device was managed. It also invented a device id
 * (`MAAS-${Date.now()}`) whenever the real API response lacked one, so the
 * dashboard's "MDM enrolled" figure was fiction on every code path.
 *
 * Here `maas360Enrolled` means one thing: MaaS360 has confirmed a managed
 * device. Sending an enrollment invitation does not set it, because an
 * invitation is not an enrollment until the missionary completes it.
 */

const MAAS360_BASE = "https://services.fiberlink.com";

/**
 * The policy profile that restricts a missionary device. It must already exist
 * in the tenant; this service never creates it.
 */
const MISSIONARY_POLICY_NAME = "LDS_Missionary_Restricted_Policy";

/** Outbound calls get a ceiling so a hung MDM endpoint cannot hold a request. */
const REQUEST_TIMEOUT_MS = 10_000;

export type EnrollmentStatus = "unavailable" | "invited" | "failed";
export type UnenrollmentStatus = "unavailable" | "not_enrolled" | "unenrolled" | "failed";

export interface EnrollmentOutcome {
  status: EnrollmentStatus;
  /** Safe to show to the leader who triggered the action. */
  message: string;
  deviceId?: string;
}

export interface UnenrollmentOutcome {
  status: UnenrollmentStatus;
  message: string;
}

const authResponseSchema = z.object({
  authResponse: z.object({ authToken: z.string().min(1) }),
});

const enrollmentResponseSchema = z.object({
  enrollmentResponse: z
    .object({
      deviceId: z.union([z.string(), z.number()]).optional(),
    })
    .optional(),
});

let cachedToken: { token: string; expiresAt: number } | null = null;

async function postJson(path: string, body: unknown, token?: string): Promise<unknown> {
  const response = await fetch(`${MAAS360_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: token } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`MaaS360 responded ${String(response.status)}`);
  }

  // `Response.json()` is typed `any`; widening to `unknown` forces the parse
  // below to be the only thing that decides the shape.
  const payload: unknown = await response.json();
  return payload;
}

/** A cached admin token, or null when MaaS360 is unconfigured or unreachable. */
async function getAuthToken(): Promise<string | null> {
  if (!isMaas360Configured) return null;
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;

  try {
    const payload = await postJson(
      `/auth-apis/auth/1.0/authenticate/customer/${String(env.MAAS360_TENANT_ID)}`,
      {
        authRequest: {
          maaS360AdminAuth: {
            platformID: "3",
            adminUserName: env.MAAS360_USERNAME,
            password: env.MAAS360_PASSWORD,
            appID: env.MAAS360_APP_ID,
            appVersion: "1.0",
            appAccessKey: env.MAAS360_APP_ACCESS_KEY,
          },
        },
      },
    );

    const parsed = authResponseSchema.safeParse(payload);
    if (!parsed.success) {
      logger.error("maas360 auth response was not understood");
      return null;
    }

    // Tokens last an hour; refresh at 55 minutes.
    cachedToken = {
      token: parsed.data.authResponse.authToken,
      expiresAt: Date.now() + 55 * 60 * 1000,
    };
    return cachedToken.token;
  } catch (error) {
    // Never log the credentials that produced this failure.
    logger.error("maas360 authentication failed", describeError(error));
    return null;
  }
}

/**
 * Invite a missionary's device to enroll and receive the restricted policy.
 *
 * A returned device id is stored so the record can be tied to MaaS360 later, but
 * `maas360Enrolled` stays false until MaaS360 confirms a managed device.
 *
 * FOLLOW-UP: nothing currently flips `maas360Enrolled` to true. That needs a
 * device-status poll or a MaaS360 webhook. Until then the admin dashboard's
 * enrolled count is honestly zero rather than dishonestly complete.
 */
export async function enrollMissionaryDevice(
  userId: string,
  phoneNumber: string,
  fullName: string,
): Promise<EnrollmentOutcome> {
  if (!isMaas360Configured) {
    logger.warn("maas360 enrollment skipped: not configured", { userId });
    return {
      status: "unavailable",
      message:
        "Device management is not configured on this server, so no enrollment was requested. " +
        "The device is NOT managed.",
    };
  }

  const token = await getAuthToken();
  if (!token) {
    return {
      status: "failed",
      message:
        "Could not authenticate with MaaS360, so no enrollment was requested. The device is NOT managed.",
    };
  }

  try {
    const payload = await postJson(
      `/device-apis/devices/2.0/sendEnrollmentInvitation/customer/${String(env.MAAS360_TENANT_ID)}`,
      {
        // No `emailAddress` and no `devicePlatform`: the old request invented an
        // address at `@ldsmissionary.internal` and declared every device iOS.
        // Neither value was ours to make up, and MaaS360 detects the platform at
        // enrollment time.
        enrollmentRequest: {
          deviceOwnership: "Corporate",
          phoneNumber,
          userName: fullName,
          policyName: MISSIONARY_POLICY_NAME,
        },
      },
      token,
    );

    const parsed = enrollmentResponseSchema.safeParse(payload);
    const rawDeviceId = parsed.success ? parsed.data.enrollmentResponse?.deviceId : undefined;
    const deviceId = rawDeviceId === undefined ? null : String(rawDeviceId);

    if (deviceId) {
      await prisma.user.update({ where: { id: userId }, data: { maas360DeviceId: deviceId } });
    }

    logger.info("maas360 enrollment invitation sent", { userId, deviceId });

    return {
      status: "invited",
      message:
        "An MDM enrollment invitation was sent to the device. It is not managed until the " +
        "missionary completes enrollment.",
      ...(deviceId ? { deviceId } : {}),
    };
  } catch (error) {
    logger.error("maas360 enrollment failed", { userId, ...describeError(error) });
    return {
      status: "failed",
      message: "MaaS360 rejected the enrollment request. The device is NOT managed.",
    };
  }
}

/**
 * Remove the restricted policy when a missionary returns home.
 *
 * A selective wipe removes only the corporate profile and data, leaving the
 * missionary's personal device intact.
 */
export async function unenrollMissionaryDevice(userId: string): Promise<UnenrollmentOutcome> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { maas360DeviceId: true, maas360Enrolled: true },
  });

  if (!user) {
    return { status: "not_enrolled", message: "No device management record for this account." };
  }

  // Rows written by the old development fallback hold a fabricated id and were
  // never enrolled anywhere. Clear them rather than trying to wipe them.
  if (!user.maas360DeviceId || user.maas360DeviceId.startsWith("DEV-MOCK")) {
    if (user.maas360Enrolled || user.maas360DeviceId) {
      await prisma.user.update({
        where: { id: userId },
        data: { maas360Enrolled: false, maas360DeviceId: null },
      });
    }
    return {
      status: "not_enrolled",
      message: "No managed device was on record, so nothing needed removing.",
    };
  }

  if (!isMaas360Configured) {
    logger.warn("maas360 unenrollment skipped: not configured", { userId });
    return {
      status: "unavailable",
      message:
        "Device management is not configured on this server, so the MDM policy was NOT removed. " +
        "It has to be removed manually in the MaaS360 console.",
    };
  }

  const token = await getAuthToken();
  if (!token) {
    return {
      status: "failed",
      message:
        "Could not authenticate with MaaS360, so the MDM policy was NOT removed. It has to be " +
        "removed manually in the MaaS360 console.",
    };
  }

  try {
    await postJson(
      `/device-apis/devices/2.0/wipeDevice/customer/${String(env.MAAS360_TENANT_ID)}`,
      { wipeRequest: { deviceId: user.maas360DeviceId, wipeType: "selective" } },
      token,
    );

    await prisma.user.update({
      where: { id: userId },
      data: { maas360Enrolled: false, maas360DeviceId: null },
    });

    logger.info("maas360 device unenrolled", { userId });
    return { status: "unenrolled", message: "The MDM policy was removed from the device." };
  } catch (error) {
    logger.error("maas360 unenrollment failed", { userId, ...describeError(error) });
    return {
      status: "failed",
      message:
        "MaaS360 rejected the removal request, so the MDM policy is still on the device. It has " +
        "to be removed manually in the MaaS360 console.",
    };
  }
}
