import type { Policy } from './policy';

/** Compact, text-only local discovery. No artifact or remote image is loaded by administration. */
export type AdminEntry = {
  id: string;
  pubkey: string;
  title: string;
  address: string | null;
  hashes: { hash: string; label: string }[];
};
export type AdminCatalog = {
  entries: AdminEntry[];
  profiles: { pubkey: string; name: string }[];
  limit: number;
};
export type AdminState = Pick<Policy, 'revision' | 'rules' | 'featured' | 'audit'> & {
  admins: string[];
  recoveryAdmins: string[];
  catalog: AdminCatalog;
};
