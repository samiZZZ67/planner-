import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import { deleteFromCloudinary, isCloudinaryConfigured } from '@/lib/server/cloudinary';
import {
  getFileMetadataById,
  getFileMetadataByPublicId,
  deleteFileMetadata,
} from '@/lib/server/files';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/files/[id]
 * Retrieves file metadata by internal database ID or Cloudinary public ID
 */
export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const session = await getSessionUser(req);
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized. Please log in with your app password.' },
        { status: 401 }
      );
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: 'File ID is required.' }, { status: 400 });
    }

    // Look up by internal ID or public ID
    const file = (await getFileMetadataById(id)) || (await getFileMetadataByPublicId(id));

    if (!file || file.deleted) {
      return NextResponse.json({ error: `File "${id}" not found.` }, { status: 404 });
    }

    // Authorization: User must own the file (or be owner)
    if (file.userId !== session.userId && session.userId !== 'owner' && file.userId !== 'owner') {
      return NextResponse.json(
        { error: 'Forbidden. You do not have permission to access this file.' },
        { status: 403 }
      );
    }

    return NextResponse.json({
      ok: true,
      file,
    });
  } catch (err: any) {
    console.error('[Files API] Get file error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to retrieve file metadata.' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/files/[id]
 * Deletes file from Cloudinary and soft deletes metadata in the database
 */
export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const session = await getSessionUser(req);
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized. Please log in with your app password.' },
        { status: 401 }
      );
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: 'File ID is required.' }, { status: 400 });
    }

    const file = (await getFileMetadataById(id)) || (await getFileMetadataByPublicId(id));

    if (!file || file.deleted) {
      return NextResponse.json({ error: `File "${id}" not found.` }, { status: 404 });
    }

    // Authorization check: User must own the file
    if (file.userId !== session.userId && session.userId !== 'owner' && file.userId !== 'owner') {
      return NextResponse.json(
        { error: 'Forbidden. You do not have permission to delete this file.' },
        { status: 403 }
      );
    }

    // 1. Delete from Cloudinary if configured
    let cloudinaryResult = null;
    if (isCloudinaryConfigured()) {
      try {
        cloudinaryResult = await deleteFromCloudinary(file.publicId, file.resourceType);
      } catch (cloudErr: any) {
        console.warn('[Files API] Cloudinary deletion warning:', cloudErr.message);
      }
    }

    // 2. Delete metadata from database
    await deleteFileMetadata(file.id);

    return NextResponse.json({
      ok: true,
      message: 'File deleted successfully from Cloudinary and database.',
      fileId: file.id,
      publicId: file.publicId,
      cloudinaryResult,
    });
  } catch (err: any) {
    console.error('[Files API] Delete error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to delete file.' },
      { status: 500 }
    );
  }
}
