import { resolve } from "node:path";

import type { App } from "firebase-admin/app";
import type { Messaging } from "firebase-admin/messaging";

import { env, isTest } from "../../config/env";
import { describeError, logger } from "../../lib/logger";

/**
 * FCM transport.
 *
 * This is the only module in the codebase that talks to Firebase. Everything
 * else goes through `notifyUsers` in ./service, which persists a Notification
 * row first and treats delivery as best-effort.
 *
 * Differences from the old services/notificationService.js:
 *
 *  - firebase-admin is imported dynamically and only when a service account is
 *    configured, so an unconfigured environment never loads the SDK. The old
 *    module `require`d it inside every send and re-resolved the service account
 *    path on each call.
 *  - The service account JSON is handed to `cert()` as a path. The old code
 *    `require`d an attacker-influenced absolute path to parse it, which is
 *    arbitrary module execution if FIREBASE_SERVICE_ACCOUNT_PATH is ever wrong.
 *  - Sends are batched with sendEachForMulticast instead of one request per
 *    recipient, and permanently dead tokens are reported back so the caller can
 *    clear them.
 *  - Nothing is written to the console.
 */

/** Named so a Firebase app initialised elsewhere cannot collide with ours. */
const APP_NAME = "chatsaints-push";

/** FCM accepts at most 500 tokens per multicast request. */
const MULTICAST_LIMIT = 500;

/**
 * Errors that mean the registration is gone for good rather than temporarily
 * unreachable. Retrying these forever is what keeps stale tokens on rows.
 */
const DEAD_TOKEN_CODES: ReadonlySet<string> = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

export interface PushMessage {
  title: string;
  body: string;
  /** FCM only carries string values in the data payload. */
  data?: Record<string, string>;
}

export interface PushDelivery {
  sent: number;
  failed: number;
  /** Tokens FCM rejected as permanently invalid. Clear these from user rows. */
  deadTokens: string[];
}

const emptyDelivery = (): PushDelivery => ({ sent: 0, failed: 0, deadTokens: [] });

/** Whether push delivery is configured at all. */
export const isPushConfigured = (): boolean => Boolean(env.FIREBASE_SERVICE_ACCOUNT_PATH);

let appPromise: Promise<App | null> | undefined;

async function initialise(): Promise<App | null> {
  const configuredPath = env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!configuredPath) return null;

  const { cert, getApps, initializeApp } = await import("firebase-admin/app");

  const existing = getApps().find((app) => app.name === APP_NAME);
  if (existing) return existing;

  // `cert` accepts a path and reads the credential itself, so the service
  // account never passes through our own require/parse.
  return initializeApp(
    { credential: cert(resolve(process.cwd(), configuredPath)) },
    APP_NAME,
  );
}

/** Initialises once per process. A failure is remembered, not retried per send. */
function firebaseApp(): Promise<App | null> {
  appPromise ??= initialise().catch((error) => {
    logger.warn("firebase admin unavailable, push delivery disabled", describeError(error));
    return null;
  });
  return appPromise;
}

/**
 * Delivers one message to many device tokens.
 *
 * Never throws: a push failure must not fail the request that triggered it. The
 * Notification row is the durable record, push is a courtesy on top.
 */
export async function sendPush(
  tokens: readonly string[],
  message: PushMessage,
): Promise<PushDelivery> {
  const delivery = emptyDelivery();
  if (isTest || tokens.length === 0) return delivery;

  const app = await firebaseApp();
  if (!app) return delivery;

  let messaging: Messaging;
  try {
    const { getMessaging } = await import("firebase-admin/messaging");
    messaging = getMessaging(app);
  } catch (error) {
    logger.error("firebase messaging unavailable", describeError(error));
    return delivery;
  }

  for (let start = 0; start < tokens.length; start += MULTICAST_LIMIT) {
    const chunk = tokens.slice(start, start + MULTICAST_LIMIT);
    try {
      const response = await messaging.sendEachForMulticast({
        tokens: [...chunk],
        notification: { title: message.title, body: message.body },
        ...(message.data ? { data: message.data } : {}),
        android: { priority: "high" },
        apns: { payload: { aps: { sound: "default", badge: 1 } } },
      });

      delivery.sent += response.successCount;
      delivery.failed += response.failureCount;

      response.responses.forEach((each, position) => {
        if (each.success) return;
        const token = chunk[position];
        if (!token) return;
        if (each.error && DEAD_TOKEN_CODES.has(each.error.code)) delivery.deadTokens.push(token);
      });
    } catch (error) {
      // Transport-level failure for the whole chunk. Count it and carry on:
      // one bad batch should not stop delivery to everyone else.
      delivery.failed += chunk.length;
      logger.error("fcm multicast failed", { batchSize: chunk.length, ...describeError(error) });
    }
  }

  return delivery;
}
