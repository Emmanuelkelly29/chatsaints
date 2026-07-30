import type { AuthenticatedUser } from "../middleware/auth";

declare global {
  namespace Express {
    interface Request {
      /**
       * Set by the `authenticate` middleware. Optional by design: routes that
       * skip authentication must not be able to read it as though it were
       * guaranteed. Use `requireUser(req)` to narrow it.
       */
      user?: AuthenticatedUser;
    }
  }
}
