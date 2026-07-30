import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

import multer from "multer";

import { env } from "../../config/env";
import { badRequest, unauthorized } from "../../middleware/errorHandler";

/**
 * Local media storage.
 *
 * Layout is `<LOCAL_UPLOAD_PATH>/<uploaderId>/<uuid>.<ext>`, and a stored file
 * reference is the `<uploaderId>/<uuid>.<ext>` part.
 *
 * Putting the uploader's id in the path is load-bearing, not cosmetic. The
 * download route has to be able to answer "did this caller upload this file?"
 * and there is no uploads table to ask, so the answer has to be derivable from
 * the reference itself. The old layout was one flat directory, which made
 * ownership unknowable.
 *
 * STORAGE_TYPE=s3 is accepted by the env schema but no S3 backend exists here or
 * in the old code. Everything below is local disk.
 */

export const UPLOAD_ROOT = path.resolve(env.LOCAL_UPLOAD_PATH);

/**
 * Accepted upload types, mapped to the extension the file is stored with.
 *
 * Exact MIME matches only. The old filter accepted anything whose type merely
 * *started with* `image/`, `video/` or `audio/`:
 *
 *     const mediaMimeAllowed = mime.startsWith('image/') || ...
 *
 * so `image/svg+xml` sailed through. An SVG is a document: it can carry
 * `<script>`, and the old static mount served it from the API origin with its
 * declared type, which is stored XSS against every session on that origin. It
 * also accepted any file whose *extension* was in a list regardless of type, and
 * anything with no extension and no type at all, which it renamed to `.webm`.
 *
 * The stored extension comes from this table rather than from
 * `path.extname(file.originalname)`, so an upload called `payload.php.jpg` or
 * `../../etc/passwd` cannot influence the name on disk at all.
 */
const ACCEPTED_UPLOAD_TYPES = new Map<string, string>([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/heic", "heic"],

  ["video/mp4", "mp4"],
  ["video/quicktime", "mov"],
  ["video/webm", "webm"],

  ["audio/mpeg", "mp3"],
  ["audio/mp4", "m4a"],
  ["audio/aac", "aac"],
  ["audio/ogg", "ogg"],
  ["audio/wav", "wav"],
  ["audio/x-wav", "wav"],
  ["audio/webm", "weba"],

  ["application/pdf", "pdf"],
  ["application/msword", "doc"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
  ["application/vnd.ms-excel", "xls"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
  ["application/vnd.ms-powerpoint", "ppt"],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx"],
  ["text/plain", "txt"],
]);

/**
 * Types rejected by name so the error explains itself.
 *
 * These are all active content. They are absent from the accepted table anyway;
 * naming them means a client that tries gets told why rather than a generic
 * "type not allowed", and it documents the decision for the next person tempted
 * to add `image/*`.
 */
const ACTIVE_CONTENT_TYPES = new Set<string>([
  "image/svg+xml",
  "image/svg",
  "text/html",
  "application/xhtml+xml",
  "text/xml",
  "application/xml",
  "text/javascript",
  "application/javascript",
  "application/ecmascript",
]);

/**
 * Extension to the `Content-Type` used when SERVING.
 *
 * Responses take their type from here, keyed by the extension this server chose
 * at upload time. The client-declared MIME type is never echoed back: trusting it
 * is what turns an upload endpoint into an XSS vector, since the attacker
 * controls both the bytes and the type they are served as.
 */
const SERVE_CONTENT_TYPES = new Map<string, string>([
  ["jpg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
  ["gif", "image/gif"],
  ["heic", "image/heic"],

  ["mp4", "video/mp4"],
  ["mov", "video/quicktime"],
  ["webm", "video/webm"],

  ["mp3", "audio/mpeg"],
  ["m4a", "audio/mp4"],
  ["aac", "audio/aac"],
  ["ogg", "audio/ogg"],
  ["wav", "audio/wav"],
  ["weba", "audio/webm"],

  ["pdf", "application/pdf"],
  ["doc", "application/msword"],
  ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["xls", "application/vnd.ms-excel"],
  ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ["ppt", "application/vnd.ms-powerpoint"],
  ["pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  ["txt", "text/plain"],
]);

/** The type to serve a stored file as, or null if the extension is unknown. */
export function serveContentTypeFor(fileName: string): string | null {
  const extension = path.extname(fileName).slice(1).toLowerCase();
  return SERVE_CONTENT_TYPES.get(extension) ?? null;
}

/** 100 MB, as before. Enforced by multer, which aborts mid-stream. */
const MAX_FILE_BYTES = 100 * 1024 * 1024;

const storage = multer.diskStorage({
  destination: (req, _file, callback) => {
    const user = req.user;
    if (!user) {
      // Only reachable if this middleware is mounted without `authenticate`.
      callback(unauthorized("Authentication required"), "");
      return;
    }

    const directory = path.join(UPLOAD_ROOT, user.id);
    try {
      mkdirSync(directory, { recursive: true });
      callback(null, directory);
    } catch (error) {
      callback(error instanceof Error ? error : new Error("Upload directory unavailable"), "");
    }
  },

  filename: (_req, file, callback) => {
    const extension = ACCEPTED_UPLOAD_TYPES.get(file.mimetype.toLowerCase());
    if (!extension) {
      // fileFilter runs first and rejects these, so this is belt and braces.
      callback(badRequest("That file type is not accepted."), "");
      return;
    }
    callback(null, `${randomUUID()}.${extension}`);
  },
});

export const uploadSingleFile = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    const mimeType = file.mimetype.toLowerCase();

    if (ACTIVE_CONTENT_TYPES.has(mimeType)) {
      callback(
        badRequest(
          "SVG, HTML, XML and script uploads are not accepted, because they can execute " +
            "in a browser. Send a raster image instead.",
        ),
      );
      return;
    }

    if (!ACCEPTED_UPLOAD_TYPES.has(mimeType)) {
      callback(badRequest(`Files of type ${file.mimetype} are not accepted.`));
      return;
    }

    callback(null, true);
  },
}).single("file");

/** Translates multer's own failures into a status the caller can act on. */
export function describeUploadFailure(error: unknown): Error {
  if (error instanceof multer.MulterError) {
    switch (error.code) {
      case "LIMIT_FILE_SIZE":
        return badRequest("That file is larger than the 100 MB limit.");
      case "LIMIT_FILE_COUNT":
      case "LIMIT_UNEXPECTED_FILE":
        return badRequest("Send exactly one file, in a field named `file`.");
      default:
        return badRequest("That upload could not be accepted.");
    }
  }
  return error instanceof Error ? error : new Error("Upload failed");
}

/**
 * Absolute path for a reference, or null if it would escape the upload root.
 *
 * The caller has already validated both halves against a UUID pattern, so this
 * cannot currently fail. It stays because the cost of being wrong here is
 * arbitrary file read.
 */
export function resolveStoredPath(ownerId: string, fileName: string): string | null {
  const absolute = path.resolve(UPLOAD_ROOT, ownerId, fileName);
  const prefix = UPLOAD_ROOT.endsWith(path.sep) ? UPLOAD_ROOT : `${UPLOAD_ROOT}${path.sep}`;
  return absolute.startsWith(prefix) ? absolute : null;
}
