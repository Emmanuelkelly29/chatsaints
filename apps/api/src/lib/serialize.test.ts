import { describe, expect, test } from "bun:test";

import { camelToSnake, toSnakeCaseDeep } from "./serialize";

describe("camelToSnake", () => {
  test("splits on capitals", () => {
    expect(camelToSnake("fullName")).toBe("full_name");
    expect(camelToSnake("missionPresidentMissionId")).toBe("mission_president_mission_id");
    expect(camelToSnake("isApproved")).toBe("is_approved");
  });

  test("keeps acronyms intact", () => {
    // Splitting on every capital produced can_view_y_s_a_directory.
    expect(camelToSnake("canViewYSADirectory")).toBe("can_view_ysa_directory");
    expect(camelToSnake("fcmToken")).toBe("fcm_token");
    expect(camelToSnake("apnsToken")).toBe("apns_token");
    expect(camelToSnake("maas360DeviceId")).toBe("maas360_device_id");
  });

  test("handles digits inside a word", () => {
    expect(camelToSnake("e2eeKeys")).toBe("e2ee_keys");
  });
});

describe("key conversion", () => {
  test("converts camelCase keys", () => {
    expect(toSnakeCaseDeep({ fullName: "A", phoneNumber: "B" })).toEqual({
      full_name: "A",
      phone_number: "B",
    });
  });

  test("leaves single-word keys alone", () => {
    expect(toSnakeCaseDeep({ id: 1, email: "a@b.c", role: "bishop" })).toEqual({
      id: 1,
      email: "a@b.c",
      role: "bishop",
    });
  });

  test("is idempotent on keys that are already snake_case", () => {
    const once = toSnakeCaseDeep({ full_name: "A" });
    expect(once).toEqual({ full_name: "A" });
    expect(toSnakeCaseDeep(once)).toEqual({ full_name: "A" });
  });

  test("leaves data-shaped keys untouched", () => {
    // Some responses are keyed by a value rather than a field name. Mangling a
    // uuid or an emoji would corrupt the payload.
    const input = {
      "ea627b60-f70b-44e6-88da-db37a83faab9": 3,
      "👍": 2,
      _count: { all: 1 },
      "some.dotted.key": true,
    };
    expect(toSnakeCaseDeep(input)).toEqual(input);
  });

  test("drops prototype-polluting keys", () => {
    const result = toSnakeCaseDeep(JSON.parse('{"__proto__":{"x":1},"safeKey":2}')) as Record<
      string,
      unknown
    >;
    expect(result["safe_key"]).toBe(2);
    expect(Object.prototype.hasOwnProperty.call(result, "__proto__")).toBe(false);
  });
});

describe("structure", () => {
  test("recurses into nested objects and arrays", () => {
    expect(
      toSnakeCaseDeep({
        conversationId: "c1",
        lastMessage: { senderId: "u1", isDeleted: false },
        members: [{ userId: "u1", isAdmin: true }],
      }),
    ).toEqual({
      conversation_id: "c1",
      last_message: { sender_id: "u1", is_deleted: false },
      members: [{ user_id: "u1", is_admin: true }],
    });
  });

  test("preserves null and primitives", () => {
    expect(toSnakeCaseDeep({ senderId: null, count: 0, ok: false })).toEqual({
      sender_id: null,
      count: 0,
      ok: false,
    });
  });

  test("handles a top-level array", () => {
    expect(toSnakeCaseDeep([{ fullName: "A" }])).toEqual([{ full_name: "A" }]);
  });
});

describe("value types that would otherwise break", () => {
  test("BigInt becomes a string instead of throwing", () => {
    // JSON.stringify throws on BigInt, and Message.mediaSizeBytes is one, so
    // a message with a media size would have produced a 500.
    const result = toSnakeCaseDeep({ mediaSizeBytes: 12345678901n }) as Record<string, unknown>;
    expect(result["media_size_bytes"]).toBe("12345678901");
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  test("Date is left for JSON to serialize", () => {
    const when = new Date("2026-07-30T12:00:00.000Z");
    const result = toSnakeCaseDeep({ createdAt: when }) as Record<string, unknown>;
    expect(result["created_at"]).toBe(when);
    expect(JSON.parse(JSON.stringify(result))).toEqual({ created_at: "2026-07-30T12:00:00.000Z" });
  });

  test("a whole Prisma-shaped row round-trips through JSON", () => {
    const row = {
      id: "u1",
      fullName: "Port Test",
      mediaSizeBytes: 900n,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      sender: null,
      reactions: [{ userId: "u2", emoji: "👍" }],
    };
    expect(JSON.parse(JSON.stringify(toSnakeCaseDeep(row)))).toEqual({
      id: "u1",
      full_name: "Port Test",
      media_size_bytes: "900",
      created_at: "2026-01-01T00:00:00.000Z",
      sender: null,
      reactions: [{ user_id: "u2", emoji: "👍" }],
    });
  });
});
