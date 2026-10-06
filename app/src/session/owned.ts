/// Whether a private client view's loaded payload belongs to the current session.

export function sessionOwns(session: string | null, loadedFor: string | null | undefined): boolean {
  if (!session) return loadedFor == null;
  if (!loadedFor) return false;
  return loadedFor.toLowerCase() === session.toLowerCase();
}
