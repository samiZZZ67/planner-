/**
 * FreeLLM Universal Model Catalog
 * 
 * Verified roster of 94+ free-tier AI models across 16+ providers,
 * tagged with exact capabilities (text, vision, audio, image_gen, video_gen, code, reasoning).
 */

export type ModelCapability =
  | 'text'
  | 'vision'
  | 'audio'
  | 'image_gen'
  | 'video_gen'
  | 'code'
  | 'reasoning';

export interface CatalogModel {
  id: string;
  name: string;
  provider: string;
  capabilities: ModelCapability[];
  contextWindow: number;
  description: string;
  isPopular?: boolean;
}

export const VERIFIED_FREE_MODELS: CatalogModel[] = [
  // ── 1. Virtual & Auto Routers ──
  {
    id: 'auto',
    name: 'Auto (Fastest Available Free Model)',
    provider: 'FreeLLM Router',
    capabilities: ['text', 'reasoning'],
    contextWindow: 1048576,
    description: 'Dynamically routes to the fastest online free provider with zero quota walls',
    isPopular: true,
  },
  {
    id: 'auto:vision',
    name: 'Auto Vision (Multimodal & Photos)',
    provider: 'FreeLLM Router',
    capabilities: ['text', 'vision'],
    contextWindow: 1048576,
    description: 'Automatically routes to the best available free vision-language model',
    isPopular: true,
  },
  {
    id: 'auto:coder',
    name: 'Auto Coder (Programming & Scripts)',
    provider: 'FreeLLM Router',
    capabilities: ['text', 'code'],
    contextWindow: 262144,
    description: 'Routes to top-tier free coding and software engineering models',
    isPopular: true,
  },

  // ── 2. Google AI Studio & Gemma (15 RPM / 1M TPM / 1.5K RPD) ──
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'Google',
    capabilities: ['text', 'vision', 'reasoning', 'code'],
    contextWindow: 1048576,
    description: 'Flagship multimodal speed, visual Q&A & reasoning (1M context)',
    isPopular: true,
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'Google',
    capabilities: ['text', 'vision', 'reasoning', 'code'],
    contextWindow: 1048576,
    description: 'Highest intelligence & complex architectural reasoning (1M context)',
    isPopular: true,
  },
  {
    id: 'gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash-Lite',
    provider: 'Google',
    capabilities: ['text', 'vision', 'code'],
    contextWindow: 1048576,
    description: 'Ultra-low latency lightweight Flash model with high free RPD ceiling',
    isPopular: true,
  },
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    provider: 'Google',
    capabilities: ['text', 'vision', 'reasoning', 'code'],
    contextWindow: 1048576,
    description: 'Fast multimodal production workhorse',
    isPopular: true,
  },
  {
    id: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    provider: 'Google',
    capabilities: ['text', 'vision', 'reasoning', 'code'],
    contextWindow: 1048576,
    description: 'Next-gen Gemini Flash preview release',
  },
  {
    id: 'gemini-3-flash-preview',
    name: 'Gemini 3 Flash Preview',
    provider: 'Google',
    capabilities: ['text', 'vision', 'code'],
    contextWindow: 1048576,
    description: 'Experimental Gemini 3 Flash generation',
  },
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro Preview',
    provider: 'Google',
    capabilities: ['text', 'vision', 'reasoning'],
    contextWindow: 1048576,
    description: 'Experimental Gemini 3.1 Pro frontier reasoning',
  },
  {
    id: 'gemini-3.1-flash-lite-preview',
    name: 'Gemini 3.1 Flash-Lite Preview',
    provider: 'Google',
    capabilities: ['text', 'code'],
    contextWindow: 1048576,
    description: 'High-speed lightweight preview model',
  },
  {
    id: 'gemma-4-31b-it',
    name: 'Gemma 4 31B IT',
    provider: 'Google',
    capabilities: ['text', 'code', 'reasoning'],
    contextWindow: 131072,
    description: 'Google open weights dense model with high reasoning capacity',
  },
  {
    id: 'gemma-4-26b-a4b-it',
    name: 'Gemma 4 26B-A4B IT',
    provider: 'Google',
    capabilities: ['text', 'code'],
    contextWindow: 131072,
    description: 'Efficient Mixture-of-Experts Gemma instruction model',
  },
  {
    id: 'gemma-3-12b-it',
    name: 'Gemma 3 12B IT',
    provider: 'Google',
    capabilities: ['text', 'code'],
    contextWindow: 32768,
    description: 'Fast open Gemma instruction-tuned model',
  },

  // ── 3. Groq Cloud (Ultra-Fast 30 RPM / 14,400 RPD) ──
  {
    id: 'llama-3.3-70b-versatile',
    name: 'Llama 3.3 70B Versatile',
    provider: 'Groq',
    capabilities: ['text', 'code', 'reasoning'],
    contextWindow: 128000,
    description: 'Ultra-fast 70B open weight Llama model on Groq LPUs',
    isPopular: true,
  },
  {
    id: 'llama-3.1-8b-instant',
    name: 'Llama 3.1 8B Instant',
    provider: 'Groq',
    capabilities: ['text', 'code'],
    contextWindow: 128000,
    description: 'Sub-second blazing fast 8B model for quick tasks',
    isPopular: true,
  },
  {
    id: 'deepseek-r1-distill-llama-70b',
    name: 'DeepSeek R1 Distill 70B',
    provider: 'Groq',
    capabilities: ['text', 'reasoning', 'code'],
    contextWindow: 128000,
    description: 'Distilled reasoning model with transparent step-by-step thinking',
    isPopular: true,
  },
  {
    id: 'openai/gpt-oss-20b',
    name: 'GPT-OSS 20B',
    provider: 'Groq',
    capabilities: ['text', 'code'],
    contextWindow: 65536,
    description: 'Open source GPT-style model optimized on Groq',
    isPopular: true,
  },
  {
    id: 'openai/gpt-oss-120b',
    name: 'GPT-OSS 120B',
    provider: 'Groq',
    capabilities: ['text', 'code', 'reasoning'],
    contextWindow: 65536,
    description: 'Large 120B open GPT-style model with high throughput',
  },
  {
    id: 'qwen/qwen3.8-27b',
    name: 'Qwen 3.8 27B',
    provider: 'Groq',
    capabilities: ['text', 'code', 'reasoning'],
    contextWindow: 65536,
    description: 'Qwen architecture accelerated on Groq LPUs',
  },
  {
    id: 'allam-2-7b',
    name: 'Allam 2 7B',
    provider: 'Groq',
    capabilities: ['text'],
    contextWindow: 32768,
    description: 'Bilingual English/Arabic specialized language model',
  },
  {
    id: 'groq/compound',
    name: 'Groq Compound',
    provider: 'Groq',
    capabilities: ['text', 'code'],
    contextWindow: 128000,
    description: 'Multi-model agentic compound orchestrator',
  },
  {
    id: 'groq/compound-mini',
    name: 'Groq Compound Mini',
    provider: 'Groq',
    capabilities: ['text'],
    contextWindow: 65536,
    description: 'Lightweight agentic compound router',
  },
  {
    id: 'mixtral-8x7b-32768',
    name: 'Mixtral 8x7B',
    provider: 'Groq',
    capabilities: ['text', 'code'],
    contextWindow: 32768,
    description: 'Fast mixture-of-experts 32k context model',
  },

  // ── 4. Cerebras (1,000+ Tokens/sec Wafer-Scale Engine) ──
  {
    id: 'cerebras-llama3.1-8b',
    name: 'Llama 3.1 8B (Cerebras)',
    provider: 'Cerebras',
    capabilities: ['text', 'code'],
    contextWindow: 131072,
    description: '1,000+ tokens/sec throughput for instantaneous responses',
    isPopular: true,
  },
  {
    id: 'cerebras-llama3.3-70b',
    name: 'Llama 3.3 70B (Cerebras)',
    provider: 'Cerebras',
    capabilities: ['text', 'code', 'reasoning'],
    contextWindow: 131072,
    description: 'High-speed 70B model with ultra-low time-to-first-token',
    isPopular: true,
  },
  {
    id: 'qwen-3-coder-480b',
    name: 'Qwen 3 Coder 480B',
    provider: 'Cerebras',
    capabilities: ['text', 'code', 'reasoning'],
    contextWindow: 131072,
    description: 'Massive 480B parameter coding model running on Cerebras hardware',
    isPopular: true,
  },
  {
    id: 'qwen3-235b',
    name: 'Qwen 3 235B',
    provider: 'Cerebras',
    capabilities: ['text', 'reasoning'],
    contextWindow: 8192,
    description: 'High throughput reasoning engine for complex math & logic',
  },
  {
    id: 'llama-4-maverick-17b-128e-instruct',
    name: 'Llama 4 Maverick',
    provider: 'Cerebras',
    capabilities: ['text', 'code'],
    contextWindow: 131072,
    description: 'Next-gen frontier MoE model running on Cerebras',
  },

  // ── 5. OpenRouter Free Tier (:free) ──
  {
    id: 'deepseek/deepseek-v3.1:free',
    name: 'DeepSeek V3.1 (Free)',
    provider: 'OpenRouter',
    capabilities: ['text', 'code', 'reasoning'],
    contextWindow: 131072,
    description: 'Frontier 671B MoE model free community endpoint',
    isPopular: true,
  },
  {
    id: 'moonshotai/kimi-k2:free',
    name: 'Kimi K2 (Free)',
    provider: 'OpenRouter',
    capabilities: ['text', 'code'],
    contextWindow: 131072,
    description: 'Long context frontier model with powerful document analysis',
    isPopular: true,
  },
  {
    id: 'moonshotai/kimi-k2.6:free',
    name: 'Kimi K2.6 (Free)',
    provider: 'OpenRouter',
    capabilities: ['text', 'code'],
    contextWindow: 131072,
    description: 'Updated Kimi flagship free tier with agentic reasoning',
  },
  {
    id: 'qwen/qwen3-coder:free',
    name: 'Qwen 3 Coder (Free)',
    provider: 'OpenRouter',
    capabilities: ['text', 'code'],
    contextWindow: 262144,
    description: '256k context dedicated coding LLM for full-repository reasoning',
    isPopular: true,
  },
  {
    id: 'z-ai/glm-4.5-air:free',
    name: 'GLM-4.5 Air (Free)',
    provider: 'OpenRouter',
    capabilities: ['text', 'code'],
    contextWindow: 131072,
    description: 'Fast multilingual GLM engine with strong Chinese/English capabilities',
  },
  {
    id: 'liquid/lfm-2.5-1.2b-instruct:free',
    name: 'Liquid LFM 2.5 1.2B (Free)',
    provider: 'OpenRouter',
    capabilities: ['text'],
    contextWindow: 32768,
    description: 'Liquid neural network architecture with constant memory scaling',
  },
  {
    id: 'liquid/lfm-2.5-1.2b-thinking:free',
    name: 'Liquid LFM 2.5 Thinking (Free)',
    provider: 'OpenRouter',
    capabilities: ['text', 'reasoning'],
    contextWindow: 32768,
    description: 'Liquid thinking reasoning model with detailed chain-of-thought',
  },
  {
    id: 'google/gemma-4-26b-a4b-it:free',
    name: 'Gemma 4 26B-A4B (Free)',
    provider: 'OpenRouter',
    capabilities: ['text', 'code'],
    contextWindow: 131072,
    description: 'Google MoE community endpoint on OpenRouter',
  },
  {
    id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    name: 'Nemotron 3 Nano Omni (Free)',
    provider: 'OpenRouter',
    capabilities: ['text', 'reasoning'],
    contextWindow: 65536,
    description: 'NVIDIA reasoning model with structured outputs',
  },
  {
    id: 'nvidia/nemotron-nano-9b-v2:free',
    name: 'Nemotron Nano 9B v2 (Free)',
    provider: 'OpenRouter',
    capabilities: ['text'],
    contextWindow: 65536,
    description: 'Efficient compact language model for fast conversational text',
  },
  {
    id: 'nvidia/nemotron-nano-12b-v2-vl:free',
    name: 'Nemotron Nano 12B VL (Free)',
    provider: 'OpenRouter',
    capabilities: ['text', 'vision'],
    contextWindow: 65536,
    description: 'NVIDIA Vision-Language endpoint for visual question answering',
    isPopular: true,
  },
  {
    id: 'meta-llama/llama-3.2-3b-instruct:free',
    name: 'Llama 3.2 3B (Free)',
    provider: 'OpenRouter',
    capabilities: ['text'],
    contextWindow: 131072,
    description: 'Fast mobile-class Llama model for instant responses',
  },
  {
    id: 'cognitivecomputations/dolphin-mistral-24b-venice-edition:free',
    name: 'Dolphin Mistral 24B (Free)',
    provider: 'OpenRouter',
    capabilities: ['text', 'code'],
    contextWindow: 32768,
    description: 'Uncensored creative model with high versatility',
  },
  {
    id: 'nousresearch/hermes-3-llama-3.1-405b:free',
    name: 'Hermes 3 405B (Free)',
    provider: 'OpenRouter',
    capabilities: ['text', 'reasoning', 'code'],
    contextWindow: 131072,
    description: 'Gigantic 405B open parameter model with frontier depth',
    isPopular: true,
  },
  {
    id: 'arcee-ai/trinity-large-thinking:free',
    name: 'Trinity Large Thinking (Free)',
    provider: 'OpenRouter',
    capabilities: ['text', 'reasoning'],
    contextWindow: 65536,
    description: 'CoT thinking specialist for complex puzzles and logic',
  },
  {
    id: 'stepfun/step-3.7-flash:free',
    name: 'StepFun Step 3.7 Flash (Free)',
    provider: 'OpenRouter',
    capabilities: ['text'],
    contextWindow: 32768,
    description: 'Fast conversational assistant from StepFun',
  },
  {
    id: 'poolside/laguna-m.1:free',
    name: 'Poolside Laguna M.1 (Free)',
    provider: 'OpenRouter',
    capabilities: ['text', 'code'],
    contextWindow: 65536,
    description: 'Specialized software engineering model for development',
  },
  {
    id: 'inclusionai/ling-2.6-1t:free',
    name: 'Ling 2.6 1T (Free)',
    provider: 'OpenRouter',
    capabilities: ['text'],
    contextWindow: 32768,
    description: 'Multilingual large vocabulary model',
  },
  {
    id: 'tencent/hy3-preview:free',
    name: 'Tencent HY3 Preview (Free)',
    provider: 'OpenRouter',
    capabilities: ['text'],
    contextWindow: 32768,
    description: 'Tencent Hunyuan architecture preview endpoint',
  },

  // ── 6. Mistral AI (Coding, Multilingual & Vision) ──
  {
    id: 'mistral-small-latest',
    name: 'Mistral Small Latest',
    provider: 'Mistral AI',
    capabilities: ['text', 'code', 'reasoning'],
    contextWindow: 32768,
    description: 'High-precision reasoning and concise multilingual output',
    isPopular: true,
  },
  {
    id: 'codestral-latest',
    name: 'Codestral Latest',
    provider: 'Mistral AI',
    capabilities: ['text', 'code'],
    contextWindow: 32768,
    description: 'State-of-the-art coding specialist trained on 80+ programming languages',
    isPopular: true,
  },
  {
    id: 'ministral-8b-latest',
    name: 'Ministral 8B Latest',
    provider: 'Mistral AI',
    capabilities: ['text'],
    contextWindow: 131072,
    description: 'Edge performance 8B instruction model with 128k context',
  },
  {
    id: 'pixtral-12b-2409',
    name: 'Pixtral 12B',
    provider: 'Mistral AI',
    capabilities: ['text', 'vision'],
    contextWindow: 131072,
    description: 'Native vision & multimodal understanding from Mistral',
    isPopular: true,
  },
  {
    id: 'open-mistral-nemo',
    name: 'Mistral NeMo 12B',
    provider: 'Mistral AI',
    capabilities: ['text', 'code'],
    contextWindow: 128000,
    description: 'Joint NVIDIA and Mistral architecture for general tasks',
  },

  // ── 7. NVIDIA NIM Free Tier ──
  {
    id: 'meta/llama-3.3-70b-instruct',
    name: 'Llama 3.3 70B (NVIDIA)',
    provider: 'NVIDIA',
    capabilities: ['text', 'code', 'reasoning'],
    contextWindow: 131072,
    description: 'Enterprise accelerated Llama running on NVIDIA TensorRT-LLM',
    isPopular: true,
  },
  {
    id: 'deepseek-ai/deepseek-v4-pro',
    name: 'DeepSeek V4 Pro (NVIDIA)',
    provider: 'NVIDIA',
    capabilities: ['text', 'reasoning', 'code'],
    contextWindow: 131072,
    description: 'DeepSeek V4 architecture running on NVIDIA HGX clusters',
    isPopular: true,
  },
  {
    id: 'deepseek-ai/deepseek-v4-flash',
    name: 'DeepSeek V4 Flash (NVIDIA)',
    provider: 'NVIDIA',
    capabilities: ['text', 'code'],
    contextWindow: 131072,
    description: 'High-speed DeepSeek V4 variant for rapid generation',
  },
  {
    id: 'mistralai/mistral-large-3-675b-instruct-2512',
    name: 'Mistral Large 3 675B (NVIDIA)',
    provider: 'NVIDIA',
    capabilities: ['text', 'reasoning', 'code'],
    contextWindow: 131072,
    description: 'Massive flagship 675B parameters running on NVIDIA NIM',
  },
  {
    id: 'minimaxai/minimax-m2.7',
    name: 'MiniMax M2.7 (NVIDIA)',
    provider: 'NVIDIA',
    capabilities: ['text', 'code'],
    contextWindow: 245760,
    description: 'Large 245k context conversational model on NVIDIA',
  },
  {
    id: 'nvidia/nemotron-3-super-120b-a12b',
    name: 'Nemotron 3 Super 120B',
    provider: 'NVIDIA',
    capabilities: ['text', 'code', 'reasoning'],
    contextWindow: 131072,
    description: 'Heavy reasoning dense model trained with RLHF',
  },
  {
    id: 'nvidia/nemotron-3-nano-30b-a3b',
    name: 'Nemotron 3 Nano 30B',
    provider: 'NVIDIA',
    capabilities: ['text'],
    contextWindow: 65536,
    description: 'Fast MoE architecture with efficient inference',
  },
  {
    id: 'moonshotai/kimi-k2.6',
    name: 'Kimi K2.6 (NVIDIA)',
    provider: 'NVIDIA',
    capabilities: ['text', 'code'],
    contextWindow: 131072,
    description: 'High-speed Kimi hosted on NVIDIA infrastructure',
  },
  {
    id: 'qwen/qwen3-coder-480b-a35b-instruct',
    name: 'Qwen 3 Coder 480B (NVIDIA)',
    provider: 'NVIDIA',
    capabilities: ['text', 'code'],
    contextWindow: 131072,
    description: 'Extreme-scale coding model running on NVIDIA NIM',
  },

  // ── 8. Cohere Free Tier ──
  {
    id: 'command-r-08-2024',
    name: 'Command R',
    provider: 'Cohere',
    capabilities: ['text', 'code'],
    contextWindow: 128000,
    description: 'Enterprise RAG and retrieval specialist with citation support',
    isPopular: true,
  },
  {
    id: 'command-r-plus',
    name: 'Command R+',
    provider: 'Cohere',
    capabilities: ['text', 'code', 'reasoning'],
    contextWindow: 128000,
    description: 'Top-tier complex multilingual enterprise model',
  },
  {
    id: 'command-a-03-2025',
    name: 'Command A (03-2025)',
    provider: 'Cohere',
    capabilities: ['text', 'reasoning'],
    contextWindow: 128000,
    description: 'Agentic reasoning Command model for workflow automation',
  },
  {
    id: 'command-a-reasoning-08-2025',
    name: 'Command A Reasoning',
    provider: 'Cohere',
    capabilities: ['text', 'reasoning'],
    contextWindow: 128000,
    description: 'Deep reasoning architecture with self-verification',
  },

  // ── 9. Zhipu AI (GLM Series) ──
  {
    id: 'glm-4-flash',
    name: 'GLM-4 Flash',
    provider: 'Zhipu AI',
    capabilities: ['text', 'code'],
    contextWindow: 128000,
    description: '100% free high-throughput GLM model',
    isPopular: true,
  },
  {
    id: 'glm-4.7-flash',
    name: 'GLM-4.7 Flash',
    provider: 'Zhipu AI',
    capabilities: ['text', 'code', 'reasoning'],
    contextWindow: 128000,
    description: 'Updated GLM reasoning engine with fast inference',
  },
  {
    id: 'glm-4.6v-flash',
    name: 'GLM-4.6V Flash',
    provider: 'Zhipu AI',
    capabilities: ['text', 'vision'],
    contextWindow: 128000,
    description: 'Multimodal vision and photo analysis model',
    isPopular: true,
  },

  // ── 10. Cloudflare Workers AI ──
  {
    id: '@cf/meta/llama-3.3-70b-instruct',
    name: 'Llama 3.3 70B (Cloudflare)',
    provider: 'Cloudflare',
    capabilities: ['text', 'code'],
    contextWindow: 128000,
    description: 'Serverless edge inference across 300+ global Cloudflare locations',
  },
  {
    id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
    name: 'DeepSeek R1 Qwen 32B (Cloudflare)',
    provider: 'Cloudflare',
    capabilities: ['text', 'reasoning'],
    contextWindow: 65536,
    description: 'Edge reasoning on Cloudflare Workers AI',
  },
  {
    id: '@cf/qwen/qwen2.5-coder-32b-instruct',
    name: 'Qwen 2.5 Coder 32B (Cloudflare)',
    provider: 'Cloudflare',
    capabilities: ['text', 'code'],
    contextWindow: 32768,
    description: 'Edge developer coding model on Cloudflare',
  },

  // ── 11. ModelScope & Open Ecosystem ──
  {
    id: 'qwen-2.5-72b-instruct',
    name: 'Qwen 2.5 72B Instruct',
    provider: 'ModelScope',
    capabilities: ['text', 'code', 'reasoning'],
    contextWindow: 131072,
    description: 'Benchmark-leading open model across math, coding, and general tasks',
    isPopular: true,
  },
  {
    id: 'qwen-2.5-32b-instruct',
    name: 'Qwen 2.5 32B Instruct',
    provider: 'ModelScope',
    capabilities: ['text', 'code'],
    contextWindow: 131072,
    description: 'Balanced performance and speed for daily developer tasks',
  },
  {
    id: 'qwen-2.5-14b-instruct',
    name: 'Qwen 2.5 14B Instruct',
    provider: 'ModelScope',
    capabilities: ['text'],
    contextWindow: 131072,
    description: 'High-speed instruction tuned model',
  },
  {
    id: 'deepseek-v3',
    name: 'DeepSeek V3 (ModelScope)',
    provider: 'ModelScope',
    capabilities: ['text', 'code', 'reasoning'],
    contextWindow: 65536,
    description: 'Open community weights hosted on ModelScope infrastructure',
  },

  // ── 12. Generative Media & Multimodal (Image / Video / Audio) ──
  {
    id: 'flux-pollinations',
    name: 'Flux 1.1 Schnell (Image Gen)',
    provider: 'Pollinations AI',
    capabilities: ['image_gen'],
    contextWindow: 4096,
    description: 'Photorealistic high-resolution image generator with zero API key needed',
    isPopular: true,
  },
  {
    id: 'sdxl-turbo',
    name: 'Stable Diffusion XL Turbo',
    provider: 'Pollinations AI',
    capabilities: ['image_gen'],
    contextWindow: 4096,
    description: 'Sub-second real-time image rendering engine',
  },
  {
    id: 'cogvideox-pollinations',
    name: 'CogVideoX (Video Gen)',
    provider: 'Pollinations AI',
    capabilities: ['video_gen'],
    contextWindow: 4096,
    description: 'Text-to-video cinematic streaming generation',
    isPopular: true,
  },
  {
    id: 'whisper-large-v3-turbo',
    name: 'Whisper Large v3 Turbo (Speech)',
    provider: 'Groq',
    capabilities: ['audio'],
    contextWindow: 16000,
    description: 'Multilingual speech-to-text transcription with sub-second latency',
    isPopular: true,
  },
  {
    id: 'speechify-neural-tts',
    name: 'Neural Voice TTS (Speech Synthesis)',
    provider: 'Web / Speechify',
    capabilities: ['audio'],
    contextWindow: 8192,
    description: 'Natural spoken response narration in real-time',
  },

  // ── 13. GitHub Models & OpenCode Zen ──
  {
    id: 'openai/gpt-4.1',
    name: 'GPT-4.1 (GitHub Models)',
    provider: 'GitHub',
    capabilities: ['text', 'code', 'reasoning'],
    contextWindow: 128000,
    description: 'Developer tier preview available via GitHub Models',
    isPopular: true,
  },
  {
    id: 'openai/text-embedding-3-small',
    name: 'Text Embedding 3 Small',
    provider: 'GitHub',
    capabilities: ['text'],
    contextWindow: 8192,
    description: 'Semantic vector representation for RAG and similarity',
  },
  {
    id: 'big-pickle',
    name: 'Big Pickle (OpenCode Zen)',
    provider: 'OpenCode',
    capabilities: ['text', 'code'],
    contextWindow: 65536,
    description: 'High-throughput stealth model for fast coding loops',
  },
  {
    id: 'deepseek-v4-flash-free',
    name: 'DeepSeek V4 Flash Free',
    provider: 'OpenCode',
    capabilities: ['text', 'code'],
    contextWindow: 65536,
    description: 'Community OpenCode endpoint for low latency requests',
  },
  {
    id: 'nemotron-3-super-free',
    name: 'Nemotron 3 Super Free',
    provider: 'OpenCode',
    capabilities: ['text', 'reasoning'],
    contextWindow: 65536,
    description: 'Zero-cost reasoning endpoint on OpenCode',
  },
  {
    id: 'minimax-m3-free',
    name: 'MiniMax M3 Free',
    provider: 'OpenCode',
    capabilities: ['text', 'code'],
    contextWindow: 131072,
    description: 'Extended context coding assistant',
  },

  // ── 14. Ollama & Self-Hosted Fallback Endpoints ──
  {
    id: 'ollama:qwen3-coder:480b',
    name: 'Qwen 3 Coder 480B (Local)',
    provider: 'Ollama',
    capabilities: ['text', 'code'],
    contextWindow: 131072,
    description: 'Self-hosted offline coding model',
  },
  {
    id: 'ollama:mistral-large-3:675b',
    name: 'Mistral Large 3 (Local)',
    provider: 'Ollama',
    capabilities: ['text', 'code'],
    contextWindow: 131072,
    description: 'Self-hosted offline frontier model',
  },
  {
    id: 'ollama:deepseek-v3.2',
    name: 'DeepSeek V3.2 (Local)',
    provider: 'Ollama',
    capabilities: ['text', 'reasoning'],
    contextWindow: 131072,
    description: 'Self-hosted offline reasoning engine',
  },
  {
    id: 'ollama:kimi-k2-thinking',
    name: 'Kimi K2 Thinking (Local)',
    provider: 'Ollama',
    capabilities: ['text', 'reasoning'],
    contextWindow: 131072,
    description: 'Self-hosted thinking model with CoT traces',
  },
  {
    id: 'ollama:gpt-oss:120b',
    name: 'GPT-OSS 120B (Local)',
    provider: 'Ollama',
    capabilities: ['text', 'code'],
    contextWindow: 65536,
    description: 'Self-hosted open model for private workloads',
  },
  {
    id: 'ollama:gpt-oss:20b',
    name: 'GPT-OSS 20B (Local)',
    provider: 'Ollama',
    capabilities: ['text', 'code'],
    contextWindow: 65536,
    description: 'Fast local inference on personal hardware',
  },
  {
    id: 'ollama:gemma4:31b',
    name: 'Gemma 4 31B (Local)',
    provider: 'Ollama',
    capabilities: ['text'],
    contextWindow: 65536,
    description: 'Local Google Gemma model running on Ollama',
  },
];

/**
 * Returns a model by its exact or slug ID
 */
export function getModelById(id: string): CatalogModel | undefined {
  if (!id) return undefined;
  const clean = id.trim().toLowerCase();
  return (
    VERIFIED_FREE_MODELS.find(m => m.id.toLowerCase() === clean) ||
    VERIFIED_FREE_MODELS.find(m => m.id.toLowerCase().includes(clean))
  );
}

/**
 * Checks if a model supports vision/multimodal input
 */
export function isVisionModel(id: string): boolean {
  if (id === 'auto:vision') return true;
  const m = getModelById(id);
  if (m?.capabilities.includes('vision')) return true;
  return /gemini|vision|vl|pixtral|llava|glm-4.*v/i.test(id);
}

/**
 * Checks if a model is an image generation model
 */
export function isImageGenModel(id: string): boolean {
  const m = getModelById(id);
  if (m?.capabilities.includes('image_gen')) return true;
  return /flux|sdxl|dall-e|image/i.test(id);
}

/**
 * Checks if a model is a video generation model
 */
export function isVideoGenModel(id: string): boolean {
  const m = getModelById(id);
  if (m?.capabilities.includes('video_gen')) return true;
  return /video|cogvideo|animate/i.test(id);
}

/**
 * Returns all models matching a given capability filter
 */
export function getModelsByCapability(cap: ModelCapability): CatalogModel[] {
  return VERIFIED_FREE_MODELS.filter(m => m.capabilities.includes(cap));
}

/**
 * Merges live dynamically discovered models from FreeLLM API Gateway with the verified catalog
 */
export function mergeDiscoveredModels(
  discovered: Array<string | { id: string; name?: string; owned_by?: string }>
): CatalogModel[] {
  const mergedMap = new Map<string, CatalogModel>();

  // 1. Seed with verified catalog
  for (const m of VERIFIED_FREE_MODELS) {
    mergedMap.set(m.id, m);
  }

  // 2. Add or update dynamically discovered models from gateway
  for (const item of discovered) {
    const id = typeof item === 'string' ? item : item.id;
    if (!id || typeof id !== 'string') continue;

    const existing = mergedMap.get(id);
    if (existing) {
      if (typeof item === 'object' && item.name) {
        existing.name = item.name;
      }
    } else {
      const name = (typeof item === 'object' && item.name) ? item.name : id;
      const provider = (typeof item === 'object' && item.owned_by) ? item.owned_by : 'FreeLLM Gateway';
      
      const caps: ModelCapability[] = ['text'];
      if (/vision|gemini|pixtral|vl|image-input/i.test(id)) caps.push('vision');
      if (/code|coder|dev/i.test(id)) caps.push('code');
      if (/reasoning|think|r1|pro/i.test(id)) caps.push('reasoning');
      if (/flux|sdxl|image/i.test(id)) caps.push('image_gen');
      if (/video|cog/i.test(id)) caps.push('video_gen');
      if (/whisper|tts|audio/i.test(id)) caps.push('audio');

      mergedMap.set(id, {
        id,
        name,
        provider,
        capabilities: caps,
        contextWindow: 65536,
        description: `Dynamically registered model on FreeLLM Gateway (${provider})`,
      });
    }
  }

  return Array.from(mergedMap.values());
}
