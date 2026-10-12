import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/server/auth';
import {
  isCloudinaryConfigured,
  validateFile,
  uploadBufferToCloudinary,
} from '@/lib/server/cloudinary';
import { saveFileMetadata, listFiles } from '@/lib/server/files';
import type { UploadedFile } from '@/types';

/**
 * POST /api/files
 * Uploads a file (PDF, image, video, audio, or document) to Cloudinary
 * and persists metadata in the database.
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Authenticate user
    const session = await getSessionUser(req);
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized. Please log in with your app password to upload files.' },
        { status: 401 }
      );
    }

    // 2. Verify Cloudinary configuration
    if (!isCloudinaryConfigured()) {
      return NextResponse.json(
        {
          error:
            'Cloudinary is not configured on the server. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.',
        },
        { status: 503 }
      );
    }

    // 3. Parse multipart form data
    const formData = await req.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json(
        { error: 'Invalid form submission. Multipart form-data expected.' },
        { status: 400 }
      );
    }

    const file = formData.get('file') as File | null;
    if (!file || typeof file.arrayBuffer !== 'function') {
      return NextResponse.json(
        { error: 'No file provided. Please include a file in the "file" field.' },
        { status: 400 }
      );
    }

    // 4. Validate file type and size
    const validation = validateFile({
      name: file.name,
      type: file.type,
      size: file.size,
    });

    if (!validation.valid || !validation.resourceType) {
      return NextResponse.json(
        { error: validation.error || 'Invalid file format or size exceeds limits.' },
        { status: 400 }
      );
    }

    // 5. In-memory buffer conversion (Render deployment compatible)
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Optional folder parameter
    const folder = (formData.get('folder') as string) || 'samsspace/uploads';
    const customTags = formData.get('tags')
      ? String(formData.get('tags')).split(',').map(t => t.trim())
      : ['samsspace'];

    // 6. Upload directly to Cloudinary using appropriate resource type
    const uploadResult = await uploadBufferToCloudinary(buffer, {
      resourceType: validation.resourceType,
      filename: file.name,
      folder,
      tags: customTags,
    });

    // 7. Construct file metadata record
    const now = Date.now();
    const fileRecord: UploadedFile = {
      id: crypto.randomUUID(),
      publicId: uploadResult.public_id,
      secureUrl: uploadResult.secure_url,
      originalFilename: file.name,
      resourceType: validation.resourceType,
      format: uploadResult.format || validation.format || '',
      fileSize: uploadResult.bytes || file.size,
      userId: session.userId,
      createdAt: now,
      updatedAt: now,
      deleted: false,
      mimeType: file.type || undefined,
      width: uploadResult.width,
      height: uploadResult.height,
      duration: uploadResult.duration,
      tags: customTags,
    };

    // 8. Store metadata in the database
    const saved = await saveFileMetadata(fileRecord);

    return NextResponse.json(
      {
        ok: true,
        file: saved,
      },
      { status: 201 }
    );
  } catch (err: any) {
    console.error('[Files API] Upload error:', err);
    return NextResponse.json(
      { error: err.message || 'File upload failed.' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/files
 * Lists uploaded files with optional filtering
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSessionUser(req);
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized. Please log in with your app password.' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const resourceType = searchParams.get('resourceType') || undefined;
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const files = await listFiles({
      userId: session.userId,
      resourceType,
      limit,
      offset,
    });

    return NextResponse.json({
      ok: true,
      files,
      count: files.length,
    });
  } catch (err: any) {
    console.error('[Files API] List error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to list files.' },
      { status: 500 }
    );
  }
}
