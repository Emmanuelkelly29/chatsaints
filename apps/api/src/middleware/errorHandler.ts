import type { NextFunction, Request, Response } from "express";

import { describeError, logger } from "../lib/logger";

/**
 * An error that is safe to describe to the caller. Anything else is reported as
 * a generic 500, because the old handler returned `err.message` verbatim on
 * unexpected failures, which leaked database and internal detail to clients.
 */
export class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const unauthorized = (message = "Unauthorized") => new HttpError(401, message);
export const forbidden = (message = "Forbidden") => new HttpError(403, message);
export const notFound = (message = "Not found") => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);

/** Known Prisma error codes worth translating into a real status. */
function fromPrismaCode(code: string): HttpError | null {
  switch (code) {
    case "P2002":
      return conflict("That record already exists.");
    case "P2025":
      return notFound("Record not found.");
    case "P2003":
      return badRequest("Referenced record does not exist.");
    default:
      return null;
  }
}

/**
 * Errors that already know they are the caller's fault.
 *
 * body-parser throws a SyntaxError carrying `status: 400` and
 * `type: "entity.parse.failed"` when a request body is not valid JSON. Without
 * this, a truncated body produced a 500 and logged a full stack trace as an
 * unhandled server error, which is both the wrong status and noise that would
 * bury real faults.
 */
function fromStatusBearingError(error: object): HttpError | null {
  const raw =
    "status" in error ? error.status : "statusCode" in error ? error.statusCode : undefined;
  if (typeof raw !== "number" || raw < 400 || raw >= 500) return null;

  const type = "type" in error ? String(error.type) : "";
  if (type === "entity.parse.failed") return badRequest("Request body is not valid JSON.");
  if (type === "entity.too.large") return new HttpError(413, "Request body is too large.");
  if (type === "charset.unsupported" || type === "encoding.unsupported") {
    return badRequest("Unsupported request encoding.");
  }
  return new HttpError(raw, "Bad request.");
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: "Route not found" });
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof HttpError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }

  if (typeof error === "object" && error !== null) {
    if ("code" in error) {
      const translated = fromPrismaCode(String(error.code));
      if (translated) {
        res.status(translated.statusCode).json({ error: translated.message });
        return;
      }
    }

    const clientError = fromStatusBearingError(error);
    if (clientError) {
      // A malformed request is not a server fault, so it is logged without a
      // stack and at a level that does not drown out real failures.
      logger.warn("rejected malformed request", {
        method: req.method,
        path: req.path,
        status: clientError.statusCode,
      });
      res.status(clientError.statusCode).json({ error: clientError.message });
      return;
    }
  }

  // Unexpected. Log the detail, tell the caller nothing.
  logger.error("unhandled error", {
    method: req.method,
    path: req.path,
    ...describeError(error),
  });
  res.status(500).json({ error: "Internal server error" });
}
