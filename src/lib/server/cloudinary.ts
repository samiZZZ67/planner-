import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import type { CloudinaryResourceType } from '@/types';

/**
 * Configure and retrieve Cloudinary v2 client
 */
export function getCloudinaryClient() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      'Cloudinary configuration missing on server. Ensure CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET are set.'
    );
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });

  return cloudinary;
}

/**
 * Check if all required Cloudinary environment variables are configured
 */
export function isCloudinaryConfigured(): boolean {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}

// Maximum allowed sizes by category
export const FILE_SIZE_LIMITS = {
  image: 15 * 1024 * 1024, // 15MB
  video: 100 * 1024 * 1024, // 100MB
  raw: 30 * 1024 * 1024, // 30MB (PDFs, docs)
  absoluteMax: 100 * 1024 * 1024, // 100MB
};

// Supported MIME types mapped to Cloudinary resource types
const SUPPORTED_MIME_TYPES: Record<string, CloudinaryResourceType> = {
  // Images -> 'image'
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'image/svg+xml': 'image',
  'image/avif': 'image',
  'image/bmp': 'image',
  'image/tiff': 'image',
  'image/x-icon': 'image',

  // Videos -> 'video'
  'video/mp4': 'video',
  'video/webm': 'video',
  'video/quicktime': 'video',
  'video/x-msvideo': 'video',
  'video/x-matroska': 'video',
  'video/ogg': 'video',

  // Audio -> 'video' (Cloudinary official requirement: audio files use 'video' resource_type)
  'audio/mpeg': 'video',
  'audio/mp3': 'video',
  'audio/wav': 'video',
  'audio/ogg': 'video',
  'audio/webm': 'video',
  'audio/x-m4a': 'video',
  'audio/aac': 'video',
  'audio/flac': 'video',

  // PDFs and Documents -> 'raw' (Preserves binary bytes and exact original files)
  'application/pdf': 'raw',
  'text/plain': 'raw',
  'text/markdown': 'raw',
  'text/csv': 'raw',
  'text/html': 'raw',
  'application/json': 'raw',
  'application/msword': 'raw',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'raw',
  'application/vnd.ms-excel': 'raw',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'raw',
  'application/vnd.ms-powerpoint': 'raw',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'raw',
  'application/zip': 'raw',
  'application/x-zip-compressed': 'raw',
};

// Supported file extensions fallback
const EXTENSION_RESOURCE_MAP: Record<string, CloudinaryResourceType> = {
  // Images
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  webp: 'image',
  gif: 'image',
  svg: 'image',
  avif: 'image',
  bmp: 'image',
  tiff: 'image',
  ico: 'image',

  // Videos
  mp4: 'video',
  webm: 'video',
  mov: 'video',
  avi: 'video',
  mkv: 'video',

  // Audio
  mp3: 'video',
  wav: 'video',
  ogg: 'video',
  m4a: 'video',
  aac: 'video',
  flac: 'video',

  // Documents / Raw
  pdf: 'raw',
  txt: 'raw',
  md: 'raw',
  csv: 'raw',
  json: 'raw',
  doc: 'raw',
  docx: 'raw',
  xls: 'raw',
  xlsx: 'raw',
  ppt: 'raw',
  pptx: 'raw',
  zip: 'raw',
};

/**
 * Determine the correct Cloudinary resource_type ('image' | 'video' | 'raw')
 */
export function determineResourceType(mimeType: string, filename: string): CloudinaryResourceType {
  const normalizedMime = (mimeType || '').toLowerCase().trim();
  if (SUPPORTED_MIME_TYPES[normalizedMime]) {
    return SUPPORTED_MIME_TYPES[normalizedMime];
  }

  // Fallback to extension check
  const ext = getFileExtension(filename);
  if (ext && EXTENSION_RESOURCE_MAP[ext]) {
    return EXTENSION_RESOURCE_MAP[ext];
  }

  if (normalizedMime.startsWith('image/')) return 'image';
  if (normalizedMime.startsWith('video/') || normalizedMime.startsWith('audio/')) return 'video';
  return 'raw';
}

/**
 * Extract lowercase file extension without dot
 */
export function getFileExtension(filename: string): string {
  const parts = (filename || '').split('.');
  if (parts.length > 1) {
    return parts.pop()!.toLowerCase().trim();
  }
  return '';
}

export interface FileValidationResult {
  valid: boolean;
  error?: string;
  resourceType?: CloudinaryResourceType;
  format?: string;
}

/**
 * Validate file type and file size against supported rules
 */
export function validateFile(file: { name: string; type: string; size: number }): FileValidationResult {
  if (!file.name) {
    return { valid: false, error: 'File name is required.' };
  }

  const ext = getFileExtension(file.name);
  const mime = (file.type || '').toLowerCase().trim();

  // Check supported mime or extension
  const isMimeSupported = Boolean(SUPPORTED_MIME_TYPES[mime]);
  const isExtSupported = Boolean(EXTENSION_RESOURCE_MAP[ext]);

  if (!isMimeSupported && !isExtSupported) {
    return {
      valid: false,
      error: `Unsupported file type "${mime || ext}". Supported formats include images (jpg, png, webp, gif, svg), videos (mp4, webm, mov), audio (mp3, wav), and documents (pdf, txt, md, docx, xlsx).`,
    };
  }

  const resourceType = determineResourceType(mime, file.name);
  const maxBytes = FILE_SIZE_LIMITS[resourceType] || FILE_SIZE_LIMITS.absoluteMax;

  if (file.size > maxBytes) {
    const maxMb = Math.round(maxBytes / (1024 * 1024));
    return {
      valid: false,
      error: `File size exceeds the ${maxMb}MB limit for ${resourceType} files (${(file.size / (1024 * 1024)).toFixed(1)}MB provided).`,
    };
  }

  return {
    valid: true,
    resourceType,
    format: ext || undefined,
  };
}

export interface UploadOptions {
  folder?: string;
  resourceType: CloudinaryResourceType;
  filename?: string;
  publicId?: string;
  tags?: string[];
}

/**
 * Upload an in-memory buffer directly to Cloudinary (Render deployment compatible)
 */
export async function uploadBufferToCloudinary(
  buffer: Buffer,
  options: UploadOptions
): Promise<UploadApiResponse> {
  const client = getCloudinaryClient();

  return new Promise((resolve, reject) => {
    const uploadStream = client.uploader.upload_stream(
      {
        folder: options.folder || 'samsspace/uploads',
        resource_type: options.resourceType,
        public_id: options.publicId,
        use_filename: true,
        unique_filename: true,
        tags: options.tags || ['samsspace'],
      },
      (error, result) => {
        if (error || !result) {
          return reject(error || new Error('Cloudinary upload returned empty response.'));
        }
        resolve(result);
      }
    );

    uploadStream.end(buffer);
  });
}

/**
 * Delete a resource from Cloudinary by public ID and resource type
 */
export async function deleteFromCloudinary(
  publicId: string,
  resourceType: CloudinaryResourceType
): Promise<{ result: string }> {
  const client = getCloudinaryClient();
  return await client.uploader.destroy(publicId, {
    resource_type: resourceType,
    invalidate: true,
  });
}

/**
 * Fetch detailed metadata of an existing resource directly from Cloudinary
 */
export async function getCloudinaryResource(
  publicId: string,
  resourceType: CloudinaryResourceType
): Promise<any> {
  const client = getCloudinaryClient();
  return await client.api.resource(publicId, {
    resource_type: resourceType,
  });
}
