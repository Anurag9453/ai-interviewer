import "server-only";
import { createServiceClient } from "./service";

export const DOCUMENTS_BUCKET = "interview-documents";

/** "<user_id>/<document_id>/<filename>" — ownership is the first path segment, matching the bucket's RLS policies. */
export function documentStoragePath(userId: string, documentId: string, filename: string): string {
  return `${userId}/${documentId}/${filename}`;
}

/**
 * Uploads always go through this service-role helper rather than a direct
 * browser-to-storage call — the upload route validates type/size BEFORE any
 * byte reaches Storage, and this keeps that check authoritative rather than
 * advisory. The bucket's own RLS policies (see the M7 migration) are
 * defense in depth for any future direct-upload path, not what this route
 * relies on today.
 */
export async function uploadDocumentBytes(path: string, bytes: Buffer, contentType: string): Promise<void> {
  const service = createServiceClient();
  const { error } = await service.storage.from(DOCUMENTS_BUCKET).upload(path, bytes, { contentType, upsert: false });
  if (error) throw error;
}

export async function deleteDocumentBytes(path: string): Promise<void> {
  const service = createServiceClient();
  const { error } = await service.storage.from(DOCUMENTS_BUCKET).remove([path]);
  if (error) throw error;
}
