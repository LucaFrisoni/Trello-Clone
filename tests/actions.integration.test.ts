// Runs the server actions against a real Postgres database to verify persistence and organization isolation.
// Requires TEST_DATABASE_URL pointing to a disposable database; the suite is skipped without it.
import { randomUUID } from "crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clerk = vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  }
  return { auth: vi.fn(), currentUser: vi.fn() };
});

vi.mock("@clerk/nextjs", () => clerk);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import { db } from "@/lib/db";
import { copyList } from "@/actions/copy-list";
import { createBoard } from "@/actions/create-board";
import { createCard } from "@/actions/create-card";
import { createList } from "@/actions/create-list";
import { deleteBoard } from "@/actions/delete-board";
import { deleteCard } from "@/actions/delete-card";
import { updateCard } from "@/actions/update-card";
import { updateCardOrder } from "@/actions/update-card-order";
import { updateList } from "@/actions/update-list";

const IMAGE = "img|https://t.test/thumb|https://t.test/full|https://t.test/html|Author";

const signInAs = (orgId: string) => clerk.auth.mockReturnValue({ userId: "user_test", orgId });

const createBoardWithList = async (orgId: string) => {
  signInAs(orgId);
  const { data: board } = await createBoard({ title: "Board", image: IMAGE });
  const { data: list } = await createList({ title: "List", boardId: board!.id });
  return { boardId: board!.id, listId: list!.id };
};

const orderItem = (card: { id: string; title: string }, listId: string) => ({
  id: card.id,
  title: card.title,
  order: 1,
  listId,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("server actions", () => {
  let orgA: string;
  let orgB: string;

  beforeEach(() => {
    orgA = `org_test_${randomUUID()}`;
    orgB = `org_test_${randomUUID()}`;
    clerk.currentUser.mockResolvedValue({
      id: "user_test",
      imageUrl: "https://img.test/u.png",
      firstName: "Test",
      lastName: "User",
    });
  });

  afterEach(async () => {
    const orgId = { in: [orgA, orgB] };
    await db.card.deleteMany({ where: { list: { board: { orgId } } } });
    await db.list.deleteMany({ where: { board: { orgId } } });
    await db.board.deleteMany({ where: { orgId } });
    await db.auditLog.deleteMany({ where: { orgId } });
    await db.orgLimit.deleteMany({ where: { orgId } });
  });

  afterAll(() => db.$disconnect());

  // Without a session no data may be written.
  it("rejects anonymous requests", async () => {
    clerk.auth.mockReturnValue({ userId: null, orgId: null });

    const result = await createBoard({ title: "Board", image: IMAGE });

    expect(result.error).toBe("Unauthorized");
  });

  // The main journey must reach the database, including the audit trail.
  it("persists boards, lists and cards with their edits", async () => {
    const { boardId, listId } = await createBoardWithList(orgA);
    const { data: card } = await createCard({ title: "Card", boardId, listId });

    await updateCard({ id: card!.id, boardId, description: "Some details" });

    const stored = await db.card.findUniqueOrThrow({ where: { id: card!.id } });
    expect(stored.description).toBe("Some details");
    expect(await db.auditLog.count({ where: { orgId: orgA } })).toBe(4);
  });

  // Copying a list must duplicate its cards in the database.
  it("copies a list together with its cards", async () => {
    const { boardId, listId } = await createBoardWithList(orgA);
    await createCard({ title: "Card", boardId, listId });

    const { data: copy } = await copyList({ id: listId, boardId });

    expect(await db.card.count({ where: { listId: copy!.id } })).toBe(1);
  });

  // Regression: renaming a list was recorded in the activity log as a card change.
  it("records list renames as list activity", async () => {
    const { boardId, listId } = await createBoardWithList(orgA);

    await updateList({ id: listId, boardId, title: "Renamed" });

    const log = await db.auditLog.findFirstOrThrow({
      where: { entityId: listId, action: "UPDATE" },
    });
    expect(log.entityType).toBe("LIST");
  });

  // Dragging a card to another list must survive a page reload.
  it("moves a card between lists of the same board", async () => {
    const { boardId, listId } = await createBoardWithList(orgA);
    const { data: target } = await createList({ title: "Target", boardId });
    const { data: card } = await createCard({ title: "Card", boardId, listId });

    const result = await updateCardOrder({ boardId, items: [orderItem(card!, target!.id)] });

    expect(result.error).toBeUndefined();
    const stored = await db.card.findUniqueOrThrow({ where: { id: card!.id } });
    expect(stored.listId).toBe(target!.id);
  });

  // Regression: the destination list was not validated, allowing writes into another organization.
  it("refuses to move a card into another organization's list", async () => {
    const foreign = await createBoardWithList(orgB);
    const own = await createBoardWithList(orgA);
    const { data: card } = await createCard({ title: "Card", ...own });

    const result = await updateCardOrder({
      boardId: own.boardId,
      items: [orderItem(card!, foreign.listId)],
    });

    expect(result.error).toBe("List not found");
    const stored = await db.card.findUniqueOrThrow({ where: { id: card!.id } });
    expect(stored.listId).toBe(own.listId);
  });

  // A member of one organization must not be able to alter another organization's cards.
  it("blocks access to another organization's cards", async () => {
    const owner = await createBoardWithList(orgA);
    const { data: card } = await createCard({ title: "Card", ...owner });

    signInAs(orgB);
    const edit = await updateCard({ id: card!.id, boardId: owner.boardId, title: "Hacked" });
    const removal = await deleteCard({ id: card!.id, boardId: owner.boardId });

    expect(edit.error).toBeDefined();
    expect(removal.error).toBeDefined();
    const stored = await db.card.findUniqueOrThrow({ where: { id: card!.id } });
    expect(stored.title).toBe("Card");
  });

  // Boundary of the free plan: five boards are allowed and the sixth is rejected.
  it("enforces the free board limit", async () => {
    signInAs(orgA);
    for (let i = 0; i < 5; i++) {
      await createBoard({ title: `Board ${i}`, image: IMAGE });
    }

    const result = await createBoard({ title: "Too many", image: IMAGE });

    expect(result.error).toMatch(/limit/);
    expect(await db.board.count({ where: { orgId: orgA } })).toBe(5);
  });

  // Deleting a board must remove its contents and return the free slot.
  it("deletes a board with its lists and frees the slot", async () => {
    const { boardId } = await createBoardWithList(orgA);

    await expect(deleteBoard({ id: boardId })).rejects.toThrow(`REDIRECT:/organization/${orgA}`);

    expect(await db.list.count({ where: { boardId } })).toBe(0);
    const limit = await db.orgLimit.findUniqueOrThrow({ where: { orgId: orgA } });
    expect(limit.count).toBe(0);
  });
});
