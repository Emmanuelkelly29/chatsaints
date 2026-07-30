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

  if (typeof error === "object" && error !== null && "code" in error) {
    const translated = fromPrismaCode(String(error.code));
    if (translated) {
      res.status(translated.statusCode).json({ error: translated.message });
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
