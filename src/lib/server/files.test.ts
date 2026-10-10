import { describe, it, expect, beforeEach } from 'vitest';
import {
  determineResourceType,
  validateFile,
  getFileExtension,
  isCloudinaryConfigured,
  FILE_SIZE_LIMITS,
} from './cloudinary';
import {
  saveFileMetadata,
  getFileMetadataById,
  getFileMetadataByPublicId,
  listFiles,
  deleteFileMetadata,
} from './files';
import type { UploadedFile } from '@/types';

describe('Cloudinary Integration & File Management', () => {
  describe('1. File Type & Resource Type Mapping', () => {
    it('should map image formats to resource_type "image"', () => {
      expect(determineResourceType('image/jpeg', 'photo.jpg')).toBe('image');
      expect(determineResourceType('image/png', 'diagram.png')).toBe('image');
      expect(determineResourceType('image/webp', 'banner.webp')).toBe('image');
      expect(determineResourceType('image/svg+xml', 'icon.svg')).toBe('image');
      expect(determineResourceType('image/gif', 'animation.gif')).toBe('image');
    });

    it('should map video and audio formats to resource_type "video"', () => {
      expect(determineResourceType('video/mp4', 'lecture.mp4')).toBe('video');
      expect(determineResourceType('video/webm', 'recording.webm')).toBe('video');
      expect(determineResourceType('video/quicktime', 'clip.mov')).toBe('video');

      // Official Cloudinary requirement: audio is handled under 'video' resource type
      expect(determineResourceType('audio/mpeg', 'podcast.mp3')).toBe('video');
      expect(determineResourceType('audio/wav', 'voice_memo.wav')).toBe('video');
      expect(determineResourceType('audio/ogg', 'sound.ogg')).toBe('video');
    });

    it('should map PDFs and raw documents to resource_type "raw"', () => {
      expect(determineResourceType('application/pdf', 'syllabus.pdf')).toBe('raw');
      expect(determineResourceType('text/plain', 'notes.txt')).toBe('raw');
      expect(determineResourceType('text/markdown', 'readme.md')).toBe('raw');
      expect(determineResourceType('text/csv', 'data.csv')).toBe('raw');
      expect(determineResourceType('application/json', 'config.json')).toBe('raw');
      expect(
        determineResourceType(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'assignment.docx'
        )
      ).toBe('raw');
    });

    it('should extract file extensions correctly', () => {
      expect(getFileExtension('document.PDF')).toBe('pdf');
      expect(getFileExtension('archive.tar.gz')).toBe('gz');
      expect(getFileExtension('no_extension')).toBe('');
    });
  });

  describe('2. Validation of File Types and Sizes', () => {
    it('should validate allowed image within size limit', () => {
      const res = validateFile({
        name: 'header.png',
        type: 'image/png',
        size: 2 * 1024 * 1024, // 2MB
      });
      expect(res.valid).toBe(true);
      expect(res.resourceType).toBe('image');
      expect(res.format).toBe('png');
    });

    it('should validate allowed PDF within size limit', () => {
      const res = validateFile({
        name: 'aastu_assignment.pdf',
        type: 'application/pdf',
        size: 5 * 1024 * 1024, // 5MB
      });
      expect(res.valid).toBe(true);
      expect(res.resourceType).toBe('raw');
      expect(res.format).toBe('pdf');
    });

    it('should validate allowed video within size limit', () => {
      const res = validateFile({
        name: 'tutorial.mp4',
        type: 'video/mp4',
        size: 40 * 1024 * 1024, // 40MB
      });
      expect(res.valid).toBe(true);
      expect(res.resourceType).toBe('video');
      expect(res.format).toBe('mp4');
    });

    it('should reject unsupported file types', () => {
      const res = validateFile({
        name: 'malicious.exe',
        type: 'application/x-msdownload',
        size: 1024,
      });
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/unsupported file type/i);
    });

    it('should reject files exceeding the category size limit', () => {
      // Image limit is 15MB
      const bigImage = validateFile({
        name: 'massive.png',
        type: 'image/png',
        size: 20 * 1024 * 1024, // 20MB
      });
      expect(bigImage.valid).toBe(false);
      expect(bigImage.error).toMatch(/exceeds/i);

      // PDF limit is 30MB
      const bigPdf = validateFile({
        name: 'huge_book.pdf',
        type: 'application/pdf',
        size: 35 * 1024 * 1024, // 35MB
      });
      expect(bigPdf.valid).toBe(false);
      expect(bigPdf.error).toMatch(/exceeds/i);
    });
  });

  describe('3. Database Metadata Storage & Authorization', () => {
    const testFileId = `file-test-${Date.now()}`;
    const testPublicId = `nightplanner/test_${Date.now()}`;

    const sampleFile: UploadedFile = {
      id: testFileId,
      publicId: testPublicId,
      secureUrl: `https://res.cloudinary.com/demo/image/upload/v12345/${testPublicId}.png`,
      originalFilename: 'project_spec.pdf',
      resourceType: 'raw',
      format: 'pdf',
      fileSize: 1024 * 512, // 512 KB
      userId: 'user_alice',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false,
      mimeType: 'application/pdf',
    };

    it('should save file metadata and retrieve it by ID', async () => {
      const saved = await saveFileMetadata(sampleFile);
      expect(saved).toBeDefined();
      expect(saved.id).toBe(testFileId);
      expect(saved.publicId).toBe(testPublicId);
      expect(saved.resourceType).toBe('raw');
      expect(saved.format).toBe('pdf');
      expect(saved.fileSize).toBe(sampleFile.fileSize);

      const retrieved = await getFileMetadataById(testFileId);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(testFileId);
      expect(retrieved?.originalFilename).toBe('project_spec.pdf');
    });

    it('should retrieve file metadata by Cloudinary publicId', async () => {
      const retrieved = await getFileMetadataByPublicId(testPublicId);
      expect(retrieved).toBeDefined();
      expect(retrieved?.publicId).toBe(testPublicId);
      expect(retrieved?.id).toBe(testFileId);
    });

    it('should list files filtered by user and resourceType', async () => {
      const aliceFiles = await listFiles({ userId: 'user_alice' });
      expect(aliceFiles.some(f => f.id === testFileId)).toBe(true);

      const bobFiles = await listFiles({ userId: 'user_bob' });
      expect(bobFiles.some(f => f.id === testFileId)).toBe(false);

      const rawFiles = await listFiles({ resourceType: 'raw' });
      expect(rawFiles.some(f => f.id === testFileId)).toBe(true);

      const imageFiles = await listFiles({ resourceType: 'image' });
      expect(imageFiles.some(f => f.id === testFileId)).toBe(false);
    });

    it('should delete file metadata and exclude it from subsequent lookups', async () => {
      const deleted = await deleteFileMetadata(testFileId);
      expect(deleted).toBe(true);

      const lookupAfter = await getFileMetadataById(testFileId);
      expect(lookupAfter).toBeNull();
    });
  });

  describe('4. Environment Variables Configuration Check', () => {
    it('should correctly report configuration status based on environment variables', () => {
      const originalEnv = {
        name: process.env.CLOUDINARY_CLOUD_NAME,
        key: process.env.CLOUDINARY_API_KEY,
        secret: process.env.CLOUDINARY_API_SECRET,
      };

      try {
        delete process.env.CLOUDINARY_CLOUD_NAME;
        delete process.env.CLOUDINARY_API_KEY;
        delete process.env.CLOUDINARY_API_SECRET;
        expect(isCloudinaryConfigured()).toBe(false);

        process.env.CLOUDINARY_CLOUD_NAME = 'test_cloud';
        process.env.CLOUDINARY_API_KEY = 'test_key';
        process.env.CLOUDINARY_API_SECRET = 'test_secret';
        expect(isCloudinaryConfigured()).toBe(true);
      } finally {
        if (originalEnv.name) process.env.CLOUDINARY_CLOUD_NAME = originalEnv.name;
        else delete process.env.CLOUDINARY_CLOUD_NAME;

        if (originalEnv.key) process.env.CLOUDINARY_API_KEY = originalEnv.key;
        else delete process.env.CLOUDINARY_API_KEY;

        if (originalEnv.secret) process.env.CLOUDINARY_API_SECRET = originalEnv.secret;
        else delete process.env.CLOUDINARY_API_SECRET;
      }
    });
  });
});
