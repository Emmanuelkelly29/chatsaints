import type { Request, RequestHandler, Response } from "express";
import type { ZodError, ZodType, z } from "zod";

import { badRequest } from "./errorHandler";

/**
 * Typed request validation.
 *
 * Handlers receive already-parsed, already-narrowed input, so no handler needs
 * to reach into `req.body` and hope. The old controllers destructured raw
 * bodies and checked truthiness by hand, which is how `role` ended up being
 * whatever the caller sent.
 */

function formatIssues(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

type Handler<T> = (data: T, req: Request, res: Response) => Promise<void> | void;

/** Validates `req.body` and hands the parsed value to the handler. */
export function withBody<S extends ZodType>(schema: S, handler: Handler<z.infer<S>>): RequestHandler {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      next(badRequest(formatIssues(parsed.error)));
      return;
    }
    void Promise.resolve(handler(parsed.data as z.infer<S>, req, res)).catch(next);
  };
}

/** Validates `req.query` and hands the parsed value to the handler. */
export function withQuery<S extends ZodType>(schema: S, handler: Handler<z.infer<S>>): RequestHandler {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      next(badRequest(formatIssues(parsed.error)));
      return;
    }
    void Promise.resolve(handler(parsed.data as z.infer<S>, req, res)).catch(next);
  };
}

/** Validates `req.params` and hands the parsed value to the handler. */
export function withParams<S extends ZodType>(schema: S, handler: Handler<z.infer<S>>): RequestHandler {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.params);
    if (!parsed.success) {
      next(badRequest(formatIssues(parsed.error)));
      return;
    }
    void Promise.resolve(handler(parsed.data as z.infer<S>, req, res)).catch(next);
  };
}

/** Wraps a handler that needs no input validation, forwarding rejections. */
export function handle(
  handler: (req: Request, res: Response) => Promise<void> | void,
): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(handler(req, res)).catch(next);
  };
}
