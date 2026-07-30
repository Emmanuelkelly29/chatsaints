import jwt, { type SignOptions } from "jsonwebtoken";

import { env, isLiveKitConfigured } from "../../config/env";
import { HttpError } from "../../middleware/errorHandler";

/**
 * LiveKit access tokens.
 *
 * A LiveKit token is an ordinary JWT signed HS256 with the project's API
 * secret. `iss` is the API key, `sub` is the participant identity, and the
 * `video` claim carries the room grant. That is the whole contract, so this
 * mints tokens directly rather than pulling in livekit-server-sdk, which was
 * never actually installed in the old build:
 *
 *     try { require('livekit-server-sdk') } catch { console.warn(...) }
 *
 * The require always threw, so the SDK path was dead code and every token came
 * from the mock branch below it.
 *
 * @see https://docs.livekit.io/frontends/reference/tokens-grants/
 */

const ALGORITHM = "HS256" as const;

/** One hour. A participant who is still in the room reconnects with a new token. */
const TOKEN_TTL_SECONDS = 60 * 60;

interface VideoGrant {
  room: string;
  roomJoin: true;
  canPublish: true;
  canSubscribe: true;
  canPublishData: true;
}

interface LiveKitClaims {
  sub: string;
  name: string;
  video: VideoGrant;
}

/**
 * Thrown when video calling is not configured.
 *
 * The old controller returned the literal string
 * `mock-livekit-token-${participantId}-${roomName}` whenever LIVEKIT_* was
 * unset, alongside `is_mock: true` and a cheerful message. Clients treated it as
 * a real token, handed it to the LiveKit SDK, and the connection failed with no
 * indication that the server had never been configured. A 503 says the thing
 * that is actually true.
 */
export function liveKitUnavailable(): HttpError {
  return new HttpError(
    503,
    "Video calling is not available: this server has no LiveKit configuration.",
  );
}

export interface LiveKitCredentials {
  url: string;
  token: string;
  expiresInSeconds: number;
}

/**
 * Mints a join token for one participant in one room.
 *
 * Throws rather than returning a placeholder when LiveKit is unconfigured. A
 * fake token is worse than an error: it moves the failure to the client, after
 * the user has already been told the call is connecting.
 */
export function issueLiveKitToken(
  roomName: string,
  participantId: string,
  participantName: string,
): LiveKitCredentials {
  const url = env.LIVEKIT_URL;
  const apiKey = env.LIVEKIT_API_KEY;
  const apiSecret = env.LIVEKIT_API_SECRET;

  if (!isLiveKitConfigured || !url || !apiKey || !apiSecret) {
    throw liveKitUnavailable();
  }

  const claims: LiveKitClaims = {
    sub: participantId,
    name: participantName,
    video: {
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  };

  const options: SignOptions = {
    algorithm: ALGORITHM,
    issuer: apiKey,
    expiresIn: TOKEN_TTL_SECONDS,
    notBefore: 0,
  };

  return {
    url,
    token: jwt.sign(claims, apiSecret, options),
    expiresInSeconds: TOKEN_TTL_SECONDS,
  };
}
