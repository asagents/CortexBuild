/**
 * Legacy Unified Database Schema (SQLite)
 *
 * All core data migrated to Supabase.
 * This file is retained for git history only.
 * Table creation and seeding are managed via Supabase migrations.
 */

// No-op stub — SQLite is no longer used at runtime
export const db: any = null;
export const initDatabase = () => {
  // console.log('📊 SQLite init skipped — using Supabase');
};

// Stub helper exports for any residual imports
export const findById = (_table: string, _id: string) => null;
export const findAll = (_table: string) => [];
export const insert = (_table: string, _data: any) => null;
export const update = (_table: string, _id: string, _data: any) => null;
export const remove = (_table: string, _id: string) => null;

export const createUser = (_user: any) => null;
export const findUserById = (_id: string) => null;
export const findUserByEmail = (_email: string) => null;
export const createCompany = (_company: any) => null;
export const findCompanyByName = (_name: string) => null;
export const createSession = (_session: any) => undefined;
export const findSessionByToken = (_token: string) => null;
export const deleteSession = (_token: string) => undefined;
export const getUsersCount = () => 0;
export const getProjectsCount = () => 0;
