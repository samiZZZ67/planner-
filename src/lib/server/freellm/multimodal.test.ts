import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isImageGenerationRequest,
  isVideoGenerationRequest,
  cleanMediaPrompt,
  generateImage,
  startVideoGeneration,
  getVideoJobStatus,
} from './multimodal';
import { sendChatCompletionWithFallback } from './gateway';

describe('FreeLLM Multimodal Intelligence & Capability Router', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Prompt Intent Detection', () => {
    it('should accurately detect image generation prompts', () => {
      expect(isImageGenerationRequest('generate an image of a cybernetic cat')).toBe(true);
      expect(isImageGenerationRequest('create a picture showing mountains at sunset')).toBe(true);
      expect(isImageGenerationRequest('draw a modern minimalist logo')).toBe(true);
      expect(isImageGenerationRequest('paint an oil portrait of an astronaut')).toBe(true);
      expect(isImageGenerationRequest('Explain quantum computing')).toBe(false);
      expect(isImageGenerationRequest('How do I study for exams?')).toBe(false);
    });

    it('should accurately detect video generation prompts', () => {
      expect(isVideoGenerationRequest('generate a video of flying over clouds')).toBe(true);
      expect(isVideoGenerationRequest('create an animation of a walking robot')).toBe(true);
      expect(isVideoGenerationRequest('make a clip of ocean waves')).toBe(true);
      expect(isVideoGenerationRequest('Tell me a story about robots')).toBe(false);
    });

    it('should clean media prompts cleanly', () => {
      expect(cleanMediaPrompt('Please generate an image of a neon city')).toBe('a neon city');
      expect(cleanMediaPrompt('Can you create a video showing a forest waterfall')).toBe('a forest waterfall');
      expect(cleanMediaPrompt('paint an illustration of a dragon')).toBe('a dragon');
    });
  });

  describe('Image Generation Engine', () => {
    it('should generate valid Pollinations AI image parameters and URL', async () => {
      const result = await generateImage({
        prompt: 'a tranquil zen garden in autumn',
        width: 800,
        height: 600,
        model: 'flux',
      });

      expect(result.imageUrl).toContain('https://image.pollinations.ai/prompt/');
      expect(result.imageUrl).toContain('width=800');
      expect(result.imageUrl).toContain('height=600');
      expect(result.imageUrl).toContain('model=flux');
      expect(result.prompt).toBe('a tranquil zen garden in autumn');
      expect(result.width).toBe(800);
      expect(result.height).toBe(600);
    });

    it('should reject empty image prompt', async () => {
      await expect(generateImage({ prompt: '' })).rejects.toThrow('Image prompt cannot be empty');
    });
  });

  describe('Video Generation Engine', () => {
    it('should start video generation and track job status', async () => {
      const job = await startVideoGeneration('nebula stars floating in space');
      expect(job.jobId).toBeDefined();
      expect(job.status).toBe('completed');
      expect(job.videoUrl).toContain('https://video.pollinations.ai/prompt/');
      expect(job.prompt).toBe('nebula stars floating in space');

      const retrieved = getVideoJobStatus(job.jobId);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.jobId).toBe(job.jobId);
    });

    it('should reject empty video prompt', async () => {
      await expect(startVideoGeneration('')).rejects.toThrow('Video prompt cannot be empty');
    });
  });

  describe('Resilient Chat Fallback', () => {
    it('should fall back to Groq or Gemini when FreeLLM gateway is unreachable', async () => {
      // Mock fetch to simulate gateway 502/failure on first call and success on Groq fallback
      const originalGroqKey = process.env.GROQ_API_KEY_1;
      process.env.GROQ_API_KEY_1 = 'gsk_test_mock_groq_key_1234567890';

      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('chat/completions') && !url.includes('groq.com')) {
          // FreeLLM gateway fails
          return Promise.resolve({
            ok: false,
            status: 502,
            statusText: 'Bad Gateway',
            text: () => Promise.resolve('Gateway offline'),
          });
        }
        if (url.includes('api.groq.com')) {
          // Groq fallback succeeds
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                choices: [{ message: { content: 'Fallback response from Groq' } }],
                model: 'llama-3.3-70b-versatile',
                usage: { prompt_tokens: 15, completion_tokens: 25, total_tokens: 40 },
              }),
          });
        }
        return Promise.reject(new Error('Unknown URL in test'));
      });

      vi.stubGlobal('fetch', mockFetch);

      const result = await sendChatCompletionWithFallback({
        messages: [{ role: 'user', content: 'Hello assistant' }],
      });

      expect(result.content).toBe('Fallback response from Groq');
      expect(result.providerUsed).toBe('Groq Cloud (Fallback)');

      if (originalGroqKey) {
        process.env.GROQ_API_KEY_1 = originalGroqKey;
      } else {
        delete process.env.GROQ_API_KEY_1;
      }
    });
  });
});
