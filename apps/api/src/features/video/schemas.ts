import { z } from "zod";

/**
 * Video room request validation.
 *
 * `max_participants` previously arrived unchecked and went straight into the
 * insert, so a client could open a room advertising a ceiling of two billion.
 * The column default is 50 and the schema caps the room at LiveKit's practical
 * limit.
 */

export const createRoomSchema = z.object({
  conversation_id: z.string().uuid(),
  max_participants: z.coerce.number().int().min(2).max(1000).default(50),
});

export const roomIdParamsSchema = z.object({
  roomId: z.string().uuid(),
});

export const conversationIdParamsSchema = z.object({
  conversationId: z.string().uuid(),
});

export type CreateRoomInput = z.infer<typeof createRoomSchema>;
