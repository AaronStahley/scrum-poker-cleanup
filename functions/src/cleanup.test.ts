import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { runCleanup } from "./cleanup";
import { testConfig } from "./test-helpers";

jest.mock("firebase-admin/firestore", () => ({ getFirestore: jest.fn() }));
jest.mock("firebase-admin/auth", () => ({ getAuth: jest.fn() }));
jest.mock("./users");
jest.mock("./players");
jest.mock("./rooms");

import { collectStaleAuthUsers } from "./users";
import { collectStalePlayers } from "./players";
import { collectStaleRooms } from "./rooms";

const mockCollectStaleAuthUsers = collectStaleAuthUsers as jest.Mock;
const mockCollectStalePlayers = collectStalePlayers as jest.Mock;
const mockCollectStaleRooms = collectStaleRooms as jest.Mock;

const mockBatch = {
  delete: jest.fn(),
  update: jest.fn(),
  commit: jest.fn().mockResolvedValue(undefined),
};
const mockRoomsGet = jest.fn();
const mockDb = {
  collection: jest.fn((name: string) => ({
    get: mockRoomsGet,
    doc: jest.fn((id: string) => ({ id, ref: {} })),
  })),
  batch: jest.fn(() => mockBatch),
};
const mockAuth = {
  deleteUsers: jest.fn(),
};

const defaultUserResult = {
  staleUids: [],
  orphanUids: [],
  allAnonUids: new Set<string>(),
};

beforeEach(() => {
  jest.clearAllMocks();
  (getFirestore as jest.Mock).mockReturnValue(mockDb);
  (getAuth as jest.Mock).mockReturnValue(mockAuth);
  mockCollectStaleAuthUsers.mockResolvedValue(defaultUserResult);
  mockCollectStalePlayers.mockResolvedValue([]);
  mockCollectStaleRooms.mockResolvedValue([]);
  mockRoomsGet.mockResolvedValue({ docs: [] });
});

describe("runCleanup — DRY_RUN", () => {
  it("returns identified counts without calling any delete", async () => {
    mockCollectStaleAuthUsers.mockResolvedValue({
      staleUids: ["uid-1", "uid-2"],
      orphanUids: [],
      allAnonUids: new Set(["uid-1", "uid-2"]),
    });
    mockCollectStalePlayers.mockResolvedValue(["p1"]);
    mockCollectStaleRooms.mockResolvedValue(["r1"]);

    const result = await runCleanup({ ...testConfig, DRY_RUN: true });

    expect(result.dryRun).toBe(true);
    expect(result.staleAuthUsers.identified).toBe(2);
    expect(result.staleAuthUsers.deleted).toBe(0);
    expect(result.stalePlayers.identified).toBe(1);
    expect(result.stalePlayers.deleted).toBe(0);
    expect(result.staleRooms.identified).toBe(1);
    expect(result.staleRooms.deleted).toBe(0);
    expect(mockAuth.deleteUsers).not.toHaveBeenCalled();
    expect(mockBatch.commit).not.toHaveBeenCalled();
  });
});

describe("runCleanup — ENABLE flags", () => {
  it("does not call collectStalePlayers when ENABLE_PLAYER_CLEANUP=false", async () => {
    await runCleanup({ ...testConfig, ENABLE_PLAYER_CLEANUP: false });

    expect(mockCollectStalePlayers).not.toHaveBeenCalled();
  });

  it("does not call collectStaleRooms when ENABLE_ROOM_CLEANUP=false", async () => {
    await runCleanup({ ...testConfig, ENABLE_ROOM_CLEANUP: false });

    expect(mockCollectStaleRooms).not.toHaveBeenCalled();
  });

  it("does not call collectStaleAuthUsers when both user and room cleanup are disabled", async () => {
    await runCleanup({
      ...testConfig,
      ENABLE_USER_CLEANUP: false,
      ENABLE_ROOM_CLEANUP: false,
    });

    expect(mockCollectStaleAuthUsers).not.toHaveBeenCalled();
  });

  it("passes empty staleUids to collectStalePlayers when ENABLE_USER_CLEANUP=false", async () => {
    mockCollectStaleAuthUsers.mockResolvedValue({
      staleUids: ["uid-stale"],
      orphanUids: [],
      allAnonUids: new Set(["uid-stale"]),
    });

    await runCleanup({
      ...testConfig,
      DRY_RUN: true,
      ENABLE_USER_CLEANUP: false,
      ENABLE_ROOM_CLEANUP: true,
    });

    const [, staleUidsArg] = mockCollectStalePlayers.mock.calls[0];
    expect(staleUidsArg.size).toBe(0);
  });

  it("passes empty staleUids to collectStaleRooms when ENABLE_USER_CLEANUP=false", async () => {
    mockCollectStaleAuthUsers.mockResolvedValue({
      staleUids: ["uid-stale"],
      orphanUids: [],
      allAnonUids: new Set(["uid-stale"]),
    });

    await runCleanup({
      ...testConfig,
      DRY_RUN: true,
      ENABLE_USER_CLEANUP: false,
      ENABLE_ROOM_CLEANUP: true,
    });

    const [, staleUidsArg] = mockCollectStaleRooms.mock.calls[0];
    expect(staleUidsArg.size).toBe(0);
  });
});

describe("runCleanup — live run error handling", () => {
  const liveConfig = { ...testConfig, DRY_RUN: false };

  it("charges Phase 4a patch failure to stalePlayers.errors not staleRooms.errors", async () => {
    mockCollectStalePlayers.mockResolvedValue(["p1"]);
    mockRoomsGet.mockResolvedValue({
      docs: [
        {
          id: "r1",
          ref: {},
          data: () => ({ players: ["p1"], spectators: [] }),
        },
      ],
    });
    mockBatch.commit.mockRejectedValueOnce(new Error("Firestore quota exceeded"));

    const result = await runCleanup(liveConfig);

    expect(result.stalePlayers.errors).toBeGreaterThan(0);
    expect(result.staleRooms.errors).toBe(0);
  });

  it("logs the failing UID (not the batch index) on partial auth delete failure", async () => {
    mockCollectStaleAuthUsers.mockResolvedValue({
      staleUids: ["uid-a", "uid-b", "uid-c"],
      orphanUids: [],
      allAnonUids: new Set(["uid-a", "uid-b", "uid-c"]),
    });
    mockAuth.deleteUsers.mockResolvedValue({
      successCount: 2,
      failureCount: 1,
      errors: [{ index: 2, error: { message: "not found" } }],
    });

    const result = await runCleanup(liveConfig);

    expect(result.errors.some((e) => e.includes("uid-c"))).toBe(true);
    expect(result.errors.some((e) => e.includes("uid=2"))).toBe(false);
  });
});
