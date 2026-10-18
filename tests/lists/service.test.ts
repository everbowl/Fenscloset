import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDb } from "../helpers";
import { seed } from "../../prisma/seed";
import { createEntry, deleteEntry, InUseError, listEntries, ProtectedEntryError, reorderEntries, updateEntry, ValidationError, countAll } from "@/lib/lists/service";
import { LIST_KINDS } from "@/lib/lists/registry";

describe("editable lists", () => {
  beforeEach(async () => { await resetDb(); process.env.DEV_MODE = "true"; await seed(); });

  it("creates, renames, archives and deletes entries of every simple kind", async () => {
    for (const kind of LIST_KINDS) {
      const parentId = kind === "subcategory" || kind === "size" ? (await listEntries("category"))[0].id : kind === "checkInOption" ? (await listEntries("checkInScale"))[0].id : undefined;
      const made = await createEntry(kind, { name: "  Zed  thing ", parentId, hex: "#123abc" });
      expect(made.name).toBe("Zed thing");
      if (kind === "color") expect(made.hex).toBe("#123ABC");
      const renamed = await updateEntry(kind, made.id, { name: "Zed renamed" });
      expect(renamed.name).toBe("Zed renamed");
      const archived = await updateEntry(kind, made.id, { isArchived: true });
      expect(archived.isArchived).toBe(true);
      expect((await listEntries(kind, { parentId })).some((e) => e.id === made.id)).toBe(false);
      expect((await listEntries(kind, { parentId, includeArchived: true })).some((e) => e.id === made.id)).toBe(true);
      await deleteEntry(kind, made.id);
      expect((await listEntries(kind, { parentId, includeArchived: true })).some((e) => e.id === made.id)).toBe(false);
    }
  });

  it("rejects blanks, duplicates, bad swatches and missing parents", async () => {
    await expect(createEntry("brand", { name: "   " })).rejects.toBeInstanceOf(ValidationError);
    await expect(createEntry("brand", { name: "Nike" })).rejects.toThrow(/already exists/);
    await expect(createEntry("color", { name: "Weird", hex: "blue" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createEntry("subcategory", { name: "Orphan" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("blocks deleting a category or closet that items use, with the count", async () => {
    const jeff = await db.person.findUniqueOrThrow({ where: { email: "jeff@everbowl.com" } });
    const tops = (await listEntries("category")).find((c) => c.name === "Tops")!;
    const custom = await createEntry("closet", { name: "Storage" });
    const item = await db.item.create({ data: { ownerId: jeff.id, categoryId: tops.id, name: "Test tee" } });
    await db.itemCloset.create({ data: { itemId: item.id, closetId: custom.id } });
    await expect(deleteEntry("category", tops.id)).rejects.toMatchObject({ name: "InUseError", count: 1 });
    await expect(deleteEntry("closet", custom.id)).rejects.toBeInstanceOf(InUseError);
    await db.itemCloset.deleteMany();
    await deleteEntry("closet", custom.id);
  });

  it("blocks deleting a color, brand, season or tag an item wears", async () => {
    const jeff = await db.person.findUniqueOrThrow({ where: { email: "jeff@everbowl.com" } });
    const black = (await listEntries("color")).find((c) => c.name === "Black")!;
    const nike = (await listEntries("brand")).find((b) => b.name === "Nike")!;
    const summer = (await listEntries("season")).find((s) => s.name === "Summer")!;
    const tag = await createEntry("tag", { name: "Beach" });
    const item = await db.item.create({
      data: { ownerId: jeff.id, name: "Black tee", brandId: nike.id, colors: { connect: { id: black.id } }, seasons: { connect: { id: summer.id } }, tags: { connect: { id: tag.id } } },
    });
    await expect(deleteEntry("color", black.id)).rejects.toMatchObject({ name: "InUseError", count: 1 });
    await expect(deleteEntry("brand", nike.id)).rejects.toBeInstanceOf(InUseError);
    await expect(deleteEntry("season", summer.id)).rejects.toBeInstanceOf(InUseError);
    await expect(deleteEntry("tag", tag.id)).rejects.toBeInstanceOf(InUseError);
    await db.item.delete({ where: { id: item.id } });
    await deleteEntry("tag", tag.id);
  });

  it("protects personal and Family closets from delete/archive", async () => {
    const family = (await listEntries("closet")).find((c) => c.closetKind === "family")!;
    await expect(deleteEntry("closet", family.id)).rejects.toBeInstanceOf(ProtectedEntryError);
    await expect(updateEntry("closet", family.id, { isArchived: true })).rejects.toBeInstanceOf(ProtectedEntryError);
    const renamed = await updateEntry("closet", family.id, { name: "The Family Closet" });
    expect(renamed.name).toBe("The Family Closet");
  });

  it("reorders and filters by parent", async () => {
    const seasons = await listEntries("season");
    await reorderEntries("season", [...seasons].reverse().map((s) => s.id));
    expect((await listEntries("season")).map((s) => s.name)).toEqual(["Winter", "Fall", "Summer", "Spring"]);
    const tops = (await listEntries("category")).find((c) => c.name === "Tops")!;
    const subs = await listEntries("subcategory", { parentId: tops.id });
    expect(subs.length).toBeGreaterThan(3);
    expect(subs.every((s) => s.parentId === tops.id)).toBe(true);
    const counts = await countAll();
    expect(counts.category).toBeGreaterThan(10);
  });
});
