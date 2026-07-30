import type { NextFunction, Request, RequestHandler, Response } from "express";

import { tierOf } from "../domain/roles";
import type { LeadershipRole } from "../generated/prisma/enums";
import { prisma } from "../lib/prisma";
import { ExpiredTokenError, verifyAccessToken } from "../lib/tokens";
import { forbidden, unauthorized } from "./errorHandler";

/**
 * Columns loaded for the authenticated caller.
 *
 * `directoryVisible` and `contactRequestPreference` are here deliberately. The
 * old query omitted them while downstream code branched on
 * `recipient.directory_visible === false` and passed
 * `recipient.contact_request_preference` into a permission check. Both were
 * always `undefined`, so a user who set "nobody" still received contact
 * requests from anyone. The privacy settings did nothing at all.
 */
export const AUTH_USER_SELECT = {
  id: true,
  fullName: true,
  phoneNumber: true,
  email: true,
  emailVerified: true,
  role: true,
  status: true,
  isApproved: true,
  stakeId: true,
  districtId: true,
  missionId: true,
  missionPresidentMissionId: true,
  missionaryModeActive: true,
  profileHidden: true,
  directoryVisible: true,
  contactRequestPreference: true,
} as const;

export interface AuthenticatedUser {
  id: string;
  fullName: string;
  phoneNumber: string;
  email: string | null;
  emailVerified: boolean;
  role: LeadershipRole;
  status: "active" | "missionary" | "pending_approval" | "suspended" | "released_missionary";
  isApproved: boolean;
  stakeId: string | null;
  districtId: string | null;
  missionId: string | null;
  missionPresidentMissionId: string | null;
  missionaryModeActive: boolean;
  profileHidden: boolean;
  directoryVisible: boolean;
  contactRequestPreference: "approved_pool" | "same_stake" | "nobody";
}

/** Narrows a request known to have passed `authenticate`. */
export function requireUser(req: Request): AuthenticatedUser {
  if (!req.user) {
    // Only reachable if a route forgot `authenticate`. Fail closed.
    throw unauthorized("Authentication required");
  }
  return req.user;
}

export const authenticate: RequestHandler = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw unauthorized("No token provided");
    }

    const token = header.slice("Bearer ".length).trim();
    if (!token) throw unauthorized("No token provided");

    let userId: string;
    try {
      userId = verifyAccessToken(token).userId;
    } catch (error) {
      throw error instanceof ExpiredTokenError
        ? unauthorized("Token expired")
        : unauthorized("Invalid token");
    }

    const user = await prisma.user.findFirst({
      where: { id: userId, status: { not: "suspended" } },
      select: AUTH_USER_SELECT,
    });

    if (!user) throw unauthorized("User not found or suspended");

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

export const requireApproved: RequestHandler = (req, _res, next) => {
  const user = requireUser(req);
  if (!user.isApproved) {
    next(forbidden("Account is pending approval by an existing leader."));
    return;
  }
  next();
};

export const requireActive: RequestHandler = (req, _res, next) => {
  const user = requireUser(req);
  if (user.status !== "active" && user.status !== "missionary") {
    next(forbidden("Account is not active."));
    return;
  }
  next();
};

export const requireEmailVerified: RequestHandler = (req, _res, next) => {
  const user = requireUser(req);
  if (!user.emailVerified) {
    next(forbidden("Email address is not verified."));
    return;
  }
  next();
};

/**
 * Restrict a route to an explicit set of roles.
 *
 * Note what is absent: the old implementation opened with
 * `if (req.user.role === 'it_support') return next()`, which bypassed every
 * role check in the application. Combined with `it_support` being missing from
 * the approval-required set, anyone could self-register into total access.
 *
 * IT support now has to be named in a route's allowlist like any other role, so
 * its reach is auditable by reading the routes.
 */
export function requireRole(...roles: LeadershipRole[]): RequestHandler {
  const allowed = new Set(roles);
  return (req, _res, next) => {
    const user = requireUser(req);
    if (!allowed.has(user.role)) {
      next(forbidden("Insufficient permissions"));
      return;
    }
    next();
  };
}

/**
 * Restrict a route to a minimum tier.
 *
 * Prefer this over hand-written comparisons. Guards written as
 * `ROLE_TIER[req.user.role] < 4` silently passed for any role missing from the
 * table, because `undefined < 4` is false. `tierOf` is exhaustive over the
 * role enum, so that cannot happen here.
 */
export function requireTier(minimum: number): RequestHandler {
  return (req, _res, next) => {
    const user = requireUser(req);
    if (tierOf(user.role) < minimum) {
      next(forbidden("Insufficient permissions"));
      return;
    }
    next();
  };
}
