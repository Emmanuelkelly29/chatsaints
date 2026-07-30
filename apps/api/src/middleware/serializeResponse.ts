import type { RequestHandler, Response } from "express";

import { toSnakeCaseDeep } from "../lib/serialize";

/**
 * Paths whose responses are already camelCase by contract and must stay that
 * way.
 *
 * The end-to-end encryption endpoints expose a Signal-style public-key bundle
 * (`registrationId`, `identityKey`, `signedPreKey`, `oneTimePreKey`), which is
 * camelCase everywhere that protocol is described. The rest of the API has
 * always spoken snake_case; e2ee was the one exception, and rewriting it would
 * change a published contract for no benefit.
 */
const EXEMPT_PREFIXES = ["/api/e2ee"];

function isExempt(path: string): boolean {
  return EXEMPT_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Converts response bodies to snake_case at the boundary.
 *
 * Implemented by wrapping `res.json` rather than by asking every handler to
 * call a helper, so it cannot be forgotten in a new route. Handlers keep
 * returning ordinary camelCase objects and stay unaware of the wire format.
 */
export const serializeResponse: RequestHandler = (req, res, next) => {
  if (isExempt(req.path)) {
    next();
    return;
  }

  const original = res.json.bind(res);
  res.json = function serialized(this: Response, body: unknown): Response {
    return original(toSnakeCaseDeep(body));
  };

  next();
};
