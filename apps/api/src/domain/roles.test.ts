import { describe, expect, test } from "bun:test";

import { LeadershipRole } from "../generated/prisma/enums";
import {
  ADMIN_ONLY_ROLES,
  atLeastTier,
  isHiddenRole,
  isSelfAssignableRole,
  outranks,
  parseRole,
  requiresLeaderApproval,
  ROLE_TIER,
  TIER,
  tierOf,
} from "./roles";

/**
 * These replace the old backend/__tests__/accessControl.test.js.
 *
 * Worth noting what that suite actually exercised: assertions like "bishop
 * cannot view stake_presidency" only hold under config/hierarchy.js, the role
 * table with a single importer. Thirteen files used utils/accessControl.js,
 * whose rules differ. The tests were validating the module almost nothing ran.
 */

describe("ROLE_TIER is exhaustive", () => {
  test("every role in the Prisma enum has a tier", () => {
    for (const role of Object.values(LeadershipRole)) {
      expect(ROLE_TIER[role]).toBeNumber();
      expect(ROLE_TIER[role]).toBeGreaterThan(0);
    }
  });

  test("no role resolves to undefined, which is what broke the old guards", () => {
    // `ROLE_TIER[role] < 4` evaluated `undefined < 4` for district_presidency
    // and ysa_adviser, which is false, so the guard let them straight through.
    for (const role of ["district_presidency", "ysa_adviser", "it_support"] as const) {
      expect(tierOf(role)).toBeNumber();
      expect(tierOf(role) < TIER.stake).toBe(tierOf(role) < 4);
    }
    expect(tierOf("district_presidency")).toBe(TIER.bishop);
    expect(tierOf("ysa_adviser")).toBe(TIER.wardLeader);
  });

  test("ordering matches the hierarchy", () => {
    expect(tierOf("ysa_member")).toBe(1);
    expect(tierOf("missionary")).toBe(1);
    expect(tierOf("bishop")).toBe(3);
    expect(tierOf("stake_presidency")).toBe(4);
    expect(tierOf("area_presidency")).toBe(7);
    expect(tierOf("first_presidency")).toBe(10);
    expect(tierOf("it_support")).toBe(11);
  });
});

describe("approval gating", () => {
  test("only plain membership skips leader approval", () => {
    for (const role of Object.values(LeadershipRole)) {
      expect(requiresLeaderApproval(role)).toBe(role !== "ysa_member");
    }
  });

  test("it_support requires approval", () => {
    // Its absence from the old set is what let anyone POST
    // /auth/register {role:"it_support"} and be auto-approved into the highest
    // tier in the system.
    expect(requiresLeaderApproval("it_support")).toBe(true);
  });

  test("district_presidency and ysa_adviser require approval", () => {
    expect(requiresLeaderApproval("district_presidency")).toBe(true);
    expect(requiresLeaderApproval("ysa_adviser")).toBe(true);
  });
});

describe("self-assignable roles", () => {
  test("it_support can never be self-claimed", () => {
    expect(isSelfAssignableRole("it_support")).toBe(false);
    expect(ADMIN_ONLY_ROLES.has("it_support")).toBe(true);
  });

  test("senior general roles can never be self-claimed", () => {
    for (const role of [
      "area_authority",
      "area_presidency",
      "general_authority",
      "apostle",
      "first_presidency",
    ] as const) {
      expect(isSelfAssignableRole(role)).toBe(false);
    }
  });

  test("ordinary and local leadership roles may be claimed, pending approval", () => {
    for (const role of ["ysa_member", "missionary", "bishop", "stake_presidency"] as const) {
      expect(isSelfAssignableRole(role)).toBe(true);
    }
  });

  test("self-assignable and admin-only are disjoint and cover every role", () => {
    for (const role of Object.values(LeadershipRole)) {
      const self = isSelfAssignableRole(role);
      const admin = ADMIN_ONLY_ROLES.has(role);
      expect(self && admin).toBe(false);
      expect(self || admin).toBe(true);
    }
  });
});

describe("parseRole narrows untrusted input", () => {
  test("accepts real roles", () => {
    expect(parseRole("bishop")).toBe("bishop");
    expect(parseRole("it_support")).toBe("it_support");
  });

  test("rejects anything else", () => {
    for (const bad of [
      "BISHOP",
      "STAKE_PRESIDENT",
      "DISTRICT_PRESIDENT",
      "COORDINATING_COUNCIL_LEADER",
      "superadmin",
      "",
      "__proto__",
      "constructor",
      "toString",
    ]) {
      expect(parseRole(bad)).toBeNull();
    }
  });

  test("rejects non-strings", () => {
    for (const bad of [null, undefined, 42, {}, [], true]) {
      expect(parseRole(bad)).toBeNull();
    }
  });

  test("three of the old admin gate strings named roles that do not exist", () => {
    // routes/admin.js gated on UPPERCASE names and requireRole lowercased both
    // sides. Six of the nine resolved to real roles, so bishops and general
    // leadership did have access. These three did not, which silently locked
    // out exactly the leaders most likely to need the admin surface.
    expect(parseRole("stake_president")).toBeNull(); // real: stake_presidency
    expect(parseRole("district_president")).toBeNull(); // real: district_presidency
    expect(parseRole("coordinating_council_leader")).toBeNull(); // real: coordinating_council

    for (const real of ["stake_presidency", "district_presidency", "coordinating_council"] as const) {
      expect(parseRole(real)).toBe(real);
    }
  });
});

describe("outranks requires strict seniority", () => {
  test("a peer does not outrank a peer", () => {
    // The old check was `approverTier >= ROLE_TIER[declaredRole]`, so a bishop
    // could approve other bishops' applications.
    expect(outranks("bishop", "bishop")).toBe(false);
    expect(outranks("stake_presidency", "stake_presidency")).toBe(false);
  });

  test("higher outranks lower", () => {
    expect(outranks("stake_presidency", "bishop")).toBe(true);
    expect(outranks("first_presidency", "apostle")).toBe(true);
    expect(outranks("it_support", "first_presidency")).toBe(true);
  });

  test("lower never outranks higher", () => {
    expect(outranks("bishop", "stake_presidency")).toBe(false);
    expect(outranks("ysa_member", "bishop")).toBe(false);
  });
});

describe("hidden roles", () => {
  test("senior general leadership is hidden", () => {
    for (const role of [
      "area_authority",
      "area_presidency",
      "general_authority",
      "apostle",
      "first_presidency",
    ] as const) {
      expect(isHiddenRole(role)).toBe(true);
    }
  });

  test("local roles are not hidden", () => {
    for (const role of ["ysa_member", "bishop", "stake_presidency", "missionary"] as const) {
      expect(isHiddenRole(role)).toBe(false);
    }
  });
});

describe("atLeastTier", () => {
  test("gates on the documented tier constants", () => {
    expect(atLeastTier("bishop", TIER.bishop)).toBe(true);
    expect(atLeastTier("bishop", TIER.stake)).toBe(false);
    expect(atLeastTier("stake_presidency", TIER.stake)).toBe(true);
    expect(atLeastTier("ysa_member", TIER.wardLeader)).toBe(false);
  });
});
