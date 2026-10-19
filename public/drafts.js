// Drafts stay in this tab, are tied to the authenticated session, and are discarded on logout.
export const DRAFT_KEY = 'mvp-private-draft-v2';
export function readDraft(storage, scope) {
  if (!scope) return {};
  try { const record = JSON.parse(storage.getItem(DRAFT_KEY) || 'null'); return record?.scope === scope && record.draft && typeof record.draft === 'object' ? record.draft : {}; } catch { return {}; }
}
export function writeDraft(storage, scope, draft) { if (scope) storage.setItem(DRAFT_KEY, JSON.stringify({ scope, draft })); }
export function discardDraft(storage) { storage.removeItem(DRAFT_KEY); }
