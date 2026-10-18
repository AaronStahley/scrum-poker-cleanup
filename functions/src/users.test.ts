import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { collectStaleAuthUsers } from "./users";
import { makeTimestamp, makeDocSnapshot, daysAgo, testConfig } from "./test-helpers";

jest.mock("firebase-admin/auth", () => ({ getAuth: jest.fn() }));
jest.mock("firebase-admin/firestore", () => ({ getFirestore: jest.fn(), Timestamp: {} }));

const mockAuth = { listUsers: jest.fn() };
const mockCollection = {
  get: jest.fn(),
  doc: jest.fn((id: string) => ({ id })),
};
const mockDb = {
  collection: jest.fn().mockReturnValue(mockCollection),
  getAll: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  (getAuth as jest.Mock).mockReturnValue(mockAuth);
  (getFirestore as jest.Mock).mockReturnValue(mockDb);
});

const makeUser = (
  uid: string,
  opts: {
    providerData?: object[];
    lastSignInTime?: string;
    creationTime?: string;
  } = {}
) => ({
  uid,
  providerData: opts.providerData ?? [],
  metadata: {
    lastSignInTime: opts.lastSignInTime ?? daysAgo(40).toUTCString(),
    creationTime: opts.creationTime ?? daysAgo(60).toUTCString(),
  },
});

const setupListUsers = (users: object[], pageToken?: string) => {
  mockAuth.listUsers.mockResolvedValue({ users, pageToken });
};

const setupPlayerDocs = (docs: ReturnType<typeof makeDocSnapshot>[]) => {
  mockDb.getAll.mockResolvedValue(docs);
};

describe("collectStaleAuthUsers", () => {
  it("ignores named users with linked providers", async () => {
    setupListUsers([makeUser("uid-named", { providerData: [{ providerId: "google.com" }] })]);
    setupPlayerDocs([]);

    const result = await collectStaleAuthUsers(testConfig);

    expect(result.allAnonUids.size).toBe(0);
    expect(result.staleUids).toHaveLength(0);
  });

  it("flags anon user with old lastJoinedAt in player doc", async () => {
    setupListUsers([makeUser("uid-anon")]);
    setupPlayerDocs([
      makeDocSnapshot("uid-anon", { lastJoinedAt: makeTimestamp(daysAgo(45)) }),
    ]);

    const result = await collectStaleAuthUsers(testConfig);

    expect(result.allAnonUids.has("uid-anon")).toBe(true);
    expect(result.staleUids).toContain("uid-anon");
    expect(result.orphanUids).not.toContain("uid-anon");
  });

  it("keeps anon user with recent lastJoinedAt in player doc", async () => {
    setupListUsers([makeUser("uid-anon")]);
    setupPlayerDocs([
      makeDocSnapshot("uid-anon", { lastJoinedAt: makeTimestamp(daysAgo(5)) }),
    ]);

    const result = await collectStaleAuthUsers(testConfig);

    expect(result.staleUids).not.toContain("uid-anon");
  });

  it("flags orphan user with no player doc and old lastSignInTime", async () => {
    setupListUsers([makeUser("uid-orphan", { lastSignInTime: daysAgo(20).toUTCString() })]);
    setupPlayerDocs([makeDocSnapshot("uid-orphan", null)]);

    const result = await collectStaleAuthUsers(testConfig);

    expect(result.staleUids).toContain("uid-orphan");
    expect(result.orphanUids).toContain("uid-orphan");
  });

  it("keeps orphan user whose lastSignInTime is within orphan threshold", async () => {
    setupListUsers([makeUser("uid-orphan", { lastSignInTime: daysAgo(3).toUTCString() })]);
    setupPlayerDocs([makeDocSnapshot("uid-orphan", null)]);

    const result = await collectStaleAuthUsers(testConfig);

    expect(result.staleUids).not.toContain("uid-orphan");
    expect(result.orphanUids).not.toContain("uid-orphan");
  });

  it("falls back to creationTime when lastSignInTime is absent for orphan", async () => {
    setupListUsers([
      makeUser("uid-orphan", {
        lastSignInTime: undefined as unknown as string,
        creationTime: daysAgo(20).toUTCString(),
      }),
    ]);
    setupPlayerDocs([makeDocSnapshot("uid-orphan", null)]);

    const result = await collectStaleAuthUsers(testConfig);

    expect(result.staleUids).toContain("uid-orphan");
    expect(result.orphanUids).toContain("uid-orphan");
  });

  it("processes multiple pages from listUsers", async () => {
    mockAuth.listUsers
      .mockResolvedValueOnce({
        users: [makeUser("uid-page1")],
        pageToken: "token-1",
      })
      .mockResolvedValueOnce({
        users: [makeUser("uid-page2")],
        pageToken: undefined,
      });
    setupPlayerDocs([
      makeDocSnapshot("uid-page1", { lastJoinedAt: makeTimestamp(daysAgo(45)) }),
      makeDocSnapshot("uid-page2", { lastJoinedAt: makeTimestamp(daysAgo(45)) }),
    ]);

    const result = await collectStaleAuthUsers(testConfig);

    expect(result.allAnonUids.has("uid-page1")).toBe(true);
    expect(result.allAnonUids.has("uid-page2")).toBe(true);
    expect(mockAuth.listUsers).toHaveBeenCalledTimes(2);
  });

  it("does not flag user whose lastJoinedAt is exactly at the threshold boundary", async () => {
    // Exactly USER_STALE_DAYS ago — should NOT be stale (< not <=).
    // Freeze Date so the test's daysAgo() and the threshold in users.ts read the same instant.
    jest.useFakeTimers({
      now: new Date("2026-06-15T12:00:00Z"),
      doNotFake: ["nextTick", "setImmediate", "setInterval", "setTimeout", "clearImmediate", "clearInterval", "clearTimeout", "queueMicrotask", "hrtime", "performance"],
    });
    setupListUsers([makeUser("uid-boundary")]);
    setupPlayerDocs([
      makeDocSnapshot("uid-boundary", { lastJoinedAt: makeTimestamp(daysAgo(30)) }),
    ]);

    try {
      const result = await collectStaleAuthUsers(testConfig);

      expect(result.staleUids).not.toContain("uid-boundary");
    } finally {
      jest.useRealTimers();
    }
  });
});
