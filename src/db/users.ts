import { getDb } from "./index.js";

export interface UserRow {
  id: number;
  username: string;
  display_name: string | null;
  password_hash: string | null;
  is_admin: number;
  status: string;
  created_at: number;
  updated_at: number;
}

export interface NewUser {
  username: string;
  displayName?: string | null;
  passwordHash?: string | null;
  isAdmin?: boolean;
}

export function countUsers(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
  return row.c;
}

export function createUser(u: NewUser): UserRow {
  const now = Date.now();
  const info = getDb()
    .prepare(
      `INSERT INTO users (username, display_name, password_hash, is_admin, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?)`
    )
    .run(
      u.username,
      u.displayName ?? null,
      u.passwordHash ?? null,
      u.isAdmin ? 1 : 0,
      now,
      now
    );
  return findUserById(Number(info.lastInsertRowid))!;
}

export function findUserById(id: number): UserRow | null {
  const row = getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  return row ?? null;
}

export function findUserByUsername(username: string): UserRow | null {
  const row = getDb()
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(username) as UserRow | undefined;
  return row ?? null;
}

export function listUsers(): UserRow[] {
  return getDb()
    .prepare("SELECT * FROM users ORDER BY id ASC")
    .all() as UserRow[];
}

export interface UserPatch {
  displayName?: string | null;
  passwordHash?: string | null;
  isAdmin?: boolean;
  status?: "active" | "disabled";
}

export function updateUser(id: number, patch: UserPatch): UserRow | null {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.displayName !== undefined) {
    sets.push("display_name = ?");
    vals.push(patch.displayName);
  }
  if (patch.passwordHash !== undefined) {
    sets.push("password_hash = ?");
    vals.push(patch.passwordHash);
  }
  if (patch.isAdmin !== undefined) {
    sets.push("is_admin = ?");
    vals.push(patch.isAdmin ? 1 : 0);
  }
  if (patch.status !== undefined) {
    sets.push("status = ?");
    vals.push(patch.status);
  }
  if (sets.length === 0) return findUserById(id);
  sets.push("updated_at = ?");
  vals.push(Date.now());
  vals.push(id);
  getDb().prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  return findUserById(id);
}

export function deleteUser(id: number): boolean {
  const info = getDb().prepare("DELETE FROM users WHERE id = ?").run(id);
  return info.changes > 0;
}
