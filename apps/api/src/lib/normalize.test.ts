import { describe, expect, test } from "bun:test";

import {
  normalizeEmail,
  normalizePersonName,
  normalizePhone,
  normalizeText,
  phoneVariants,
} from "./normalize";

describe("normalizeEmail", () => {
  test("trims and lowercases", () => {
    expect(normalizeEmail("  Person@Example.ORG ")).toBe("person@example.org");
  });

  test("is idempotent", () => {
    const once = normalizeEmail(" A@B.C ");
    expect(normalizeEmail(once)).toBe(once);
  });
});

describe("normalizePersonName", () => {
  test("title-cases all-caps and all-lowercase input", () => {
    expect(normalizePersonName("JOHN")).toBe("John");
    expect(normalizePersonName("john")).toBe("John");
    expect(normalizePersonName("JOHN SMITH")).toBe("John Smith");
  });

  test("handles hyphens and apostrophes", () => {
    expect(normalizePersonName("mary-jane")).toBe("Mary-Jane");
    expect(normalizePersonName("o'brien")).toBe("O'Brien");
    expect(normalizePersonName("ANNE-MARIE O'NEILL")).toBe("Anne-Marie O'Neill");
  });

  test("preserves deliberate mixed case exactly", () => {
    // The user knows better than we do. Do not "correct" these.
    for (const name of ["McDonald", "van der Berg", "DeSoto", "MacLeod", "iPhone Guy"]) {
      expect(normalizePersonName(name)).toBe(name);
    }
  });

  test("trims and collapses internal whitespace", () => {
    expect(normalizePersonName("  john    smith  ")).toBe("John Smith");
    expect(normalizePersonName("McDonald   Junior")).toBe("McDonald Junior");
  });

  test("handles empty and whitespace-only input", () => {
    expect(normalizePersonName("")).toBe("");
    expect(normalizePersonName("   ")).toBe("");
  });
});

describe("normalizeText", () => {
  test("trims and collapses whitespace without changing case", () => {
    expect(normalizeText("  Lagos   Nigeria  Ikeja ")).toBe("Lagos Nigeria Ikeja");
    expect(normalizeText("ALL CAPS STAYS")).toBe("ALL CAPS STAYS");
  });
});

describe("normalizePhone", () => {
  test("strips spaces, dashes and parentheses", () => {
    expect(normalizePhone(" +234 (801) 234-5678 ")).toBe("+2348012345678");
  });

  test("is stable, so lookups match what was stored", () => {
    // Registration previously checked duplicates against a trimmed value but
    // stored the raw one, so a leading space created an account that later
    // lookups could not find.
    const stored = normalizePhone(" +2348012345678");
    const looked = normalizePhone("+2348012345678 ");
    expect(stored).toBe(looked);
  });
});

describe("phoneVariants", () => {
  test("includes the normalized form", () => {
    expect(phoneVariants("+2348012345678")).toContain("+2348012345678");
  });

  test("offers the local form for an international number", () => {
    expect(phoneVariants("+2348012345678")).toContain("08012345678");
  });

  test("offers the international form for a local number", () => {
    expect(phoneVariants("08012345678")).toContain("+2348012345678");
  });

  test("never returns duplicates", () => {
    const variants = phoneVariants("+2348012345678");
    expect(new Set(variants).size).toBe(variants.length);
  });
});
