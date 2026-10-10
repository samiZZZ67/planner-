import { getDb, ensureSchema } from './neon';
import {
  getLocalFiles,
  getLocalFileById,
  getLocalFileByPublicId,
  saveLocalFile,
  deleteLocalFile,
} from './localDb';
import type { UploadedFile, CloudinaryResourceType } from '@/types';

/**
 * Format a Neon SQL row into an UploadedFile object
 */
function mapRowToFile(r: any): UploadedFile {
  return {
    id: r.id,
    publicId: r.public_id,
    secureUrl: r.secure_url,
    originalFilename: r.original_filename,
    resourceType: r.resource_type as CloudinaryResourceType,
    format: r.format || '',
    fileSize: Number(r.file_size || 0),
    userId: r.user_id || 'owner',
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    deleted: Boolean(r.deleted),
    mimeType: r.mime_type || undefined,
    width: r.width ? Number(r.width) : undefined,
    height: r.height ? Number(r.height) : undefined,
    duration: r.duration ? Number(r.duration) : undefined,
    tags: Array.isArray(r.tags) ? r.tags : [],
  };
}

/**
 * Save uploaded file metadata to the database (Neon Postgres and mirrored to localDb)
 */
export async function saveFileMetadata(file: UploadedFile): Promise<UploadedFile> {
  const sql = getDb();
  if (sql) {
    try {
      await ensureSchema(sql);
      const inserted = await sql`
        INSERT INTO files (
          id, public_id, secure_url, original_filename, resource_type,
          format, file_size, user_id, created_at, updated_at, deleted,
          mime_type, width, height, duration, tags
        ) VALUES (
          ${file.id}, ${file.publicId}, ${file.secureUrl}, ${file.originalFilename},
          ${file.resourceType}, ${file.format || ''}, ${file.fileSize}, ${file.userId || 'owner'},
          ${file.createdAt}, ${file.updatedAt}, ${file.deleted}, ${file.mimeType || null},
          ${file.width || null}, ${file.height || null}, ${file.duration || null},
          ${JSON.stringify(file.tags || [])}::jsonb
        )
        RETURNING *
      `;
      if (inserted && inserted.length > 0) {
        const saved = mapRowToFile(inserted[0]);
        saveLocalFile(saved);
        return saved;
      }
    } catch (err: any) {
      console.warn('[Files Service] Neon insert warning, falling back to localDb:', err.message);
    }
  }

  // Local DB store
  const saved = saveLocalFile(file);
  return saved;
}

/**
 * Retrieve file metadata by internal database ID
 */
export async function getFileMetadataById(id: string): Promise<UploadedFile | null> {
  const sql = getDb();
  if (sql) {
    try {
      await ensureSchema(sql);
      const rows = await sql`SELECT * FROM files WHERE id = ${id} AND deleted = FALSE LIMIT 1`;
      if (rows && rows.length > 0) {
        return mapRowToFile(rows[0]);
      }
    } catch (err: any) {
      console.warn('[Files Service] Neon getById warning, falling back to localDb:', err.message);
    }
  }

  return getLocalFileById(id);
}

/**
 * Retrieve file metadata by Cloudinary public ID
 */
export async function getFileMetadataByPublicId(publicId: string): Promise<UploadedFile | null> {
  const sql = getDb();
  if (sql) {
    try {
      await ensureSchema(sql);
      const rows = await sql`SELECT * FROM files WHERE public_id = ${publicId} AND deleted = FALSE LIMIT 1`;
      if (rows && rows.length > 0) {
        return mapRowToFile(rows[0]);
      }
    } catch (err: any) {
      console.warn('[Files Service] Neon getByPublicId warning, falling back to localDb:', err.message);
    }
  }

  return getLocalFileByPublicId(publicId);
}

export interface ListFilesFilter {
  userId?: string;
  resourceType?: string;
  limit?: number;
  offset?: number;
}

/**
 * List files with optional filtering by user and resource type
 */
export async function listFiles(filter?: ListFilesFilter): Promise<UploadedFile[]> {
  const sql = getDb();
  if (sql) {
    try {
      await ensureSchema(sql);
      const limit = Math.min(filter?.limit || 50, 100);
      const offset = filter?.offset || 0;

      let rows;
      if (filter?.userId && filter.userId !== 'owner' && filter.resourceType) {
        rows = await sql`
          SELECT * FROM files 
          WHERE deleted = FALSE AND user_id = ${filter.userId} AND resource_type = ${filter.resourceType}
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      } else if (filter?.userId && filter.userId !== 'owner') {
        rows = await sql`
          SELECT * FROM files 
          WHERE deleted = FALSE AND user_id = ${filter.userId}
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      } else if (filter?.resourceType) {
        rows = await sql`
          SELECT * FROM files 
          WHERE deleted = FALSE AND resource_type = ${filter.resourceType}
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      } else {
        rows = await sql`
          SELECT * FROM files 
          WHERE deleted = FALSE
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      }

      if (rows) {
        return rows.map(mapRowToFile);
      }
    } catch (err: any) {
      console.warn('[Files Service] Neon listFiles warning, falling back to localDb:', err.message);
    }
  }

  const local = getLocalFiles({
    userId: filter?.userId,
    resourceType: filter?.resourceType,
  });
  const offset = filter?.offset || 0;
  const limit = filter?.limit || 50;
  return local.slice(offset, offset + limit);
}

/**
 * Soft delete file metadata in the database
 */
export async function deleteFileMetadata(id: string): Promise<boolean> {
  const sql = getDb();
  let neonSuccess = false;

  if (sql) {
    try {
      await ensureSchema(sql);
      const now = Date.now();
      await sql`UPDATE files SET deleted = TRUE, updated_at = ${now} WHERE id = ${id}`;
      neonSuccess = true;
    } catch (err: any) {
      console.warn('[Files Service] Neon deleteFile warning, falling back to localDb:', err.message);
    }
  }

  const localSuccess = deleteLocalFile(id);
  return neonSuccess || localSuccess;
}
