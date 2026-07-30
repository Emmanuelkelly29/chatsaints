import { z } from "zod";

import { LeadershipRole, UserStatus } from "../../generated/prisma/enums";
import { normalizeText } from "../../lib/normalize";

/**
 * Admin query validation.
 *
 * `role` and `status` are checked against the real Prisma enums, so a filter can
 * no longer reach the database as an arbitrary string. The old handler passed
 * `req.query.role` through to a `u.role::text = $1` comparison, and
 * `parseInt(limit)` with no ceiling, so `?limit=1000000` was a valid request.
 */

const optionalUuidParam = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().uuid("A valid id is required").optional(),
);

const optionalSearchTerm = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().min(1).max(120).transform(normalizeText).optional(),
);

const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
};

export const userListQuerySchema = z.object({
  ...pageQuery,
  role: z.enum(LeadershipRole).optional(),
  status: z.enum(UserStatus).optional(),
  stake_id: optionalUuidParam,
  search: optionalSearchTerm,
});

export const stakeListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const userParamsSchema = z.object({
  id: z.string().uuid("A valid user id is required"),
});

export const suspendUserSchema = z.object({
  suspended: z.boolean({ message: "suspended must be true or false" }),
  reason: z.string().trim().max(500).transform(normalizeText).optional(),
});

export type UserListQuery = z.infer<typeof userListQuerySchema>;
export type StakeListQuery = z.infer<typeof stakeListQuerySchema>;
export type SuspendUserInput = z.infer<typeof suspendUserSchema>;
