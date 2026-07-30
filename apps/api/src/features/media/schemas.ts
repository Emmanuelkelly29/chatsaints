import { z } from "zod";

/**
 * A stored file name, exactly as this server writes it: a v4 UUID and one
 * extension from the upload allowlist.
 *
 * Anything else is rejected before it reaches the filesystem. That closes path
 * traversal (`..`, `/`, `\`, NUL are all unmatched), double extensions, and
 * dotfiles, without relying on the resolved path check that follows it.
 */
const STORED_FILE_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,5}$/;

export const fileParamsSchema = z.object({
  ownerId: z.string().uuid(),
  fileName: z.string().regex(STORED_FILE_NAME, "Not a valid file reference"),
});

export type FileParams = z.infer<typeof fileParamsSchema>;
