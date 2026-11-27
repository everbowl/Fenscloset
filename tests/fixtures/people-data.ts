/**
 * The synthetic household every test and e2e spec runs against. Invented first names and `@example.test` addresses only:
 * no real person appears anywhere in the repository. Roles mirror a real household: two adult admins (the minor's two
 * guardians), one adult member, one minor.
 */
export type FixturePerson = {
  key: "admin" | "parent" | "adult" | "minor";
  name: string;
  email: string | null;
  role: "admin" | "member" | "minor";
  /** Keys of this person's guardians (minors only). */
  guardians?: ("admin" | "parent")[];
};

export const FIXTURE_PEOPLE: Record<FixturePerson["key"], FixturePerson> = {
  /** The household's first admin: the one with an address, who signs in by e-mail. */
  admin: { key: "admin", name: "Avery", email: "avery@example.test", role: "admin" },
  /** The second adult admin and the minor's other guardian. */
  parent: { key: "parent", name: "Blake", email: null, role: "admin" },
  /** An adult member with their own closet. */
  adult: { key: "adult", name: "Casey", email: null, role: "member" },
  /** A minor with two guardians. */
  minor: { key: "minor", name: "Devon", email: null, role: "minor", guardians: ["admin", "parent"] },
};

export const FIXTURE_ADMIN_EMAIL = FIXTURE_PEOPLE.admin.email as string;
/** The password the e2e suite gives the fixture admin when a spec starts signed in. */
export const FIXTURE_ADMIN_PASSWORD = "closet-rocks-2026";
