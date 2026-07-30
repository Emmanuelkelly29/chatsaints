import { createReadStream } from "node:fs";

import { Router, type Request, type RequestHandler, type Response } from "express";

import { describeError, logger } from "../../lib/logger";
import { authenticate, requireActive, requireUser } from "../../middleware/auth";
import { badRequest } from "../../middleware/errorHandler";
import { handle, withParams } from "../../middleware/validate";
import { fileParamsSchema } from "./schemas";
import { authorizeFileAccess, describeUpload, type ResolvedFile } from "./service";
import { describeUploadFailure, uploadSingleFile } from "./storage";

export const mediaRouter = Router();

/**
 * Runs multer and turns its failures into real statuses.
 *
 * Left to itself multer calls `next(MulterError)`, which the error handler cannot
 * recognise, so an oversized file became an opaque 500. The old route did not
 * even get that far: a rejected file left `req.file` undefined and the handler
 * answered "No file uploaded or file type not allowed" for both cases at once.
 */
const receiveUpload: RequestHandler = (req, res, next) => {
  uploadSingleFile(req, res, (error: unknown) => {
    next(error ? describeUploadFailure(error) : undefined);
  });
};

/**
 * Uploading requires an active account.
 *
 * The old route was `authenticate` alone, which let an account that had
 * registered and never verified its email write 100 MB per request to the
 * server's disk. `requireApproved` is deliberately not here: a leader awaiting
 * approval on their claimed role can still send a photo.
 */
mediaRouter.post(
  "/upload",
  authenticate,
  requireActive,
  receiveUpload,
  handle((req, res) => {
    const file = req.file;
    if (!file) throw badRequest("Attach a file in a field named `file`.");

    const result = describeUpload(requireUser(req).id, file);
    logger.info("media uploaded", {
      ownerId: requireUser(req).id,
      contentType: result.contentType,
      sizeBytes: result.sizeBytes,
    });
    res.status(201).json(result);
  }),
);

/**
 * Streams a stored file to a caller who is entitled to it.
 *
 * `authenticate` only: entitlement is a property of the file, not of the caller's
 * standing, and someone whose account has been suspended mid-conversation should
 * not have their client silently fail to render history. Every authorization
 * decision is in `authorizeFileAccess`, and every denial is a 404.
 */
mediaRouter.get(
  "/file/:ownerId/:fileName",
  authenticate,
  withParams(fileParamsSchema, async (params, req, res) => {
    const file = await authorizeFileAccess(requireUser(req).id, params.ownerId, params.fileName);
    sendFile(req, res, file);
  }),
);

/** A single byte range, or null for "send the whole thing". */
type RangeRequest = { start: number; end: number } | null;

/**
 * Parses a single-range `Range` header.
 *
 * Only one range is honoured. Multipart ranges buy nothing for audio and video
 * seeking, which is the only reason this exists, and cost a multipart encoder.
 * Anything unparseable is treated as absent rather than as an error, which is
 * what RFC 9110 asks for; only a syntactically valid but unsatisfiable range
 * gets a 416.
 */
function parseRange(header: string | undefined, sizeBytes: number): RangeRequest | "unsatisfiable" {
  if (!header) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === undefined || rawEnd === undefined) return null;
  if (rawStart === "" && rawEnd === "") return null;

  // A suffix range, "bytes=-500", means the last 500 bytes.
  if (rawStart === "") {
    const suffixLength = Number(rawEnd);
    if (suffixLength <= 0) return "unsatisfiable";
    return { start: Math.max(0, sizeBytes - suffixLength), end: sizeBytes - 1 };
  }

  const start = Number(rawStart);
  if (start >= sizeBytes) return "unsatisfiable";

  const end = rawEnd === "" ? sizeBytes - 1 : Math.min(Number(rawEnd), sizeBytes - 1);
  if (end < start) return "unsatisfiable";

  return { start, end };
}

/**
 * Writes the response headers and pipes the file.
 *
 * Three headers here are security controls rather than metadata:
 *
 *   - `Content-Type` comes from the server-side allowlist, keyed by the
 *     extension this server assigned at upload. The uploader's declared type is
 *     never echoed.
 *   - `Content-Disposition: attachment` stops a top-level navigation to this URL
 *     rendering the file in the API's origin. Images, audio and video still play
 *     normally when referenced by an element, so nothing legitimate breaks.
 *   - `X-Content-Type-Options: nosniff` stops a browser from disregarding the
 *     type above and guessing from the bytes.
 *
 * `Cache-Control: private, no-store` replaces the `public, immutable` that nginx
 * used to add. These files are authorized per caller; a shared cache holding one
 * would serve it to the next person to ask.
 */
function sendFile(req: Request, res: Response, file: ResolvedFile): void {
  const range = parseRange(req.headers.range, file.sizeBytes);

  res.setHeader("Content-Type", file.contentType);
  // fileName is a validated UUID plus extension, so it cannot break the header.
  res.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Accept-Ranges", "bytes");

  if (range === "unsatisfiable") {
    res.setHeader("Content-Range", `bytes */${file.sizeBytes}`);
    res.status(416).end();
    return;
  }

  if (range) {
    res.status(206);
    res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${file.sizeBytes}`);
    res.setHeader("Content-Length", range.end - range.start + 1);
  } else {
    res.setHeader("Content-Length", file.sizeBytes);
  }

  const stream = createReadStream(
    file.absolutePath,
    range ? { start: range.start, end: range.end } : {},
  );

  // Once bytes are moving the error handler cannot help: the status line is
  // already sent. Drop the connection and record why.
  stream.on("error", (error: unknown) => {
    logger.error("media stream failed", describeError(error));
    res.destroy();
  });

  // A client that navigates away mid-download leaves the stream open otherwise.
  res.on("close", () => {
    stream.destroy();
  });

  stream.pipe(res);
}
