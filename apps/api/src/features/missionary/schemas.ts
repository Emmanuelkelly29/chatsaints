import { z } from "zod";

/**
 * Missionary mode input.
 *
 * The old handlers destructured `{ user_id, mission_id, start_date }` from the
 * body and passed them straight into UPDATE statements, so a missing `user_id`
 * became `WHERE id = undefined` and an arbitrary `start_date` string was written
 * to a date column.
 */

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export const activateMissionarySchema = z.object({
  user_id: z.string().uuid("A valid user id is required"),
  mission_id: z.string().uuid("A valid mission id is required"),
  start_date: z.coerce
    .date()
    .refine((value) => value.getTime() < Date.now() + ONE_YEAR_MS, {
      message: "Start date is too far in the future",
    })
    .optional(),
});

export const deactivateMissionarySchema = z.object({
  user_id: z.string().uuid("A valid user id is required"),
});

export const missionParamsSchema = z.object({
  mission_id: z.string().uuid("A valid mission id is required"),
});

export type ActivateMissionaryInput = z.infer<typeof activateMissionarySchema>;
export type DeactivateMissionaryInput = z.infer<typeof deactivateMissionarySchema>;
