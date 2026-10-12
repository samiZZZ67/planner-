import { describe, it, expect } from 'vitest';
import {
  VERIFIED_FREE_MODELS,
  getModelById,
  getModelsByCapability,
  mergeDiscoveredModels,
} from './catalog';

describe('FreeLLM Universal Model Catalog', () => {
  it('should contain at least 84+ verified free models', () => {
    expect(VERIFIED_FREE_MODELS.length).toBeGreaterThanOrEqual(84);
  });

  it('should have key flagship models configured', () => {
    const auto = getModelById('auto');
    expect(auto).toBeDefined();
    expect(auto?.name).toContain('Auto');

    const gemini = getModelById('gemini-2.5-flash');
    expect(gemini).toBeDefined();
    expect(gemini?.capabilities).toContain('vision');

    const groqLlama = getModelById('llama-3.3-70b-versatile');
    expect(groqLlama).toBeDefined();
    expect(groqLlama?.provider).toBe('Groq');

    const deepseek = getModelById('deepseek-r1-distill-llama-70b');
    expect(deepseek).toBeDefined();
    expect(deepseek?.capabilities).toContain('reasoning');

    const flux = getModelById('flux');
    expect(flux).toBeDefined();
    expect(flux?.capabilities).toContain('image_gen');
  });

  it('should filter models by capability correctly', () => {
    const visionModels = getModelsByCapability('vision');
    expect(visionModels.length).toBeGreaterThan(0);
    expect(visionModels.some(m => m.id === 'gemini-2.5-flash')).toBe(true);

    const codeModels = getModelsByCapability('code');
    expect(codeModels.length).toBeGreaterThan(0);
    expect(codeModels.some(m => m.id === 'codestral-latest')).toBe(true);

    const reasoningModels = getModelsByCapability('reasoning');
    expect(reasoningModels.length).toBeGreaterThan(0);
    expect(reasoningModels.some(m => m.id === 'deepseek-r1-distill-llama-70b')).toBe(true);
  });

  it('should dynamically merge new discovered models from FreeLLM Gateway', () => {
    const customList = [
      'new-future-llama-4',
      { id: 'custom-community-vision-model', name: 'Community Vision V1', owned_by: 'Community' },
      'gemini-2.5-flash', // Existing model
    ];

    const merged = mergeDiscoveredModels(customList);
    expect(merged.length).toBeGreaterThan(VERIFIED_FREE_MODELS.length);

    const foundFuture = merged.find(m => m.id === 'new-future-llama-4');
    expect(foundFuture).toBeDefined();

    const foundCommunity = merged.find(m => m.id === 'custom-community-vision-model');
    expect(foundCommunity).toBeDefined();
    expect(foundCommunity?.name).toBe('Community Vision V1');
    expect(foundCommunity?.capabilities).toContain('vision');
  });
});
