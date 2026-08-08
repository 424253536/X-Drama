export type ApiChannelType = 'text' | 'image' | 'video' | 'audio';
export type ApiChannelFieldKind = 'text' | 'secret' | 'number' | 'boolean';

export interface ApiChannelExtraField {
  key: string;
  label: string;
  kind: ApiChannelFieldKind;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
  description?: string;
}

export interface ApiChannelFormatDefinition {
  type: ApiChannelType;
  format: string;
  label: string;
  description: string;
  defaultBaseUrl: string;
  defaultModel: string;
  modelRequired: boolean;
  extraFields: ApiChannelExtraField[];
}

export const API_CHANNEL_TYPES: readonly ApiChannelType[] = ['text', 'image', 'video', 'audio'];

export const API_CHANNEL_FORMATS: readonly ApiChannelFormatDefinition[] = [
  {
    type: 'text', format: 'openai', label: 'OpenAI Chat Completions',
    description: '兼容 /v1/chat/completions 的 OpenAI、New API、OpenRouter 及多数中转站。',
    defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o', modelRequired: true, extraFields: [],
  },
  {
    type: 'text', format: 'gemini', label: 'Gemini generateContent',
    description: 'Google Gemini 原生 generateContent 格式及其兼容中转。',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-2.5-pro', modelRequired: true, extraFields: [],
  },
  {
    type: 'text', format: 'anthropic', label: 'Anthropic Messages',
    description: '兼容 /v1/messages 的 Claude 官方接口及中转站。',
    defaultBaseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-sonnet-4-6', modelRequired: true,
    extraFields: [{ key: 'anthropicVersion', label: 'Anthropic Version', kind: 'text', defaultValue: '2023-06-01' }],
  },
  {
    type: 'image', format: 'openai', label: 'OpenAI Images',
    description: '兼容 /v1/images/generations 的 GPT Image、DALL-E、Seedream 等中转模型。',
    defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-image-1', modelRequired: true, extraFields: [],
  },
  {
    type: 'image', format: 'openai-chat-image', label: 'OpenAI Chat Image',
    description: '兼容通过 /v1/chat/completions 返回 Markdown、URL 或 Data URI 图片的 New API 中转模型。',
    defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-image-2', modelRequired: true, extraFields: [],
  },
  {
    type: 'image', format: 'gemini', label: 'Gemini Image',
    description: 'Gemini 原生 generateContent 图像格式，支持参考图。',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-3-pro-image', modelRequired: true, extraFields: [],
  },
  {
    type: 'video', format: 'openai', label: 'OpenAI Videos',
    description: '兼容 POST /v1/videos 与 GET /v1/videos/{id} 的视频中转站。',
    defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: 'seedance-1-5-pro', modelRequired: true,
    extraFields: [{ key: 'nativeAudio', label: '支持原生音画', kind: 'boolean', defaultValue: 'true' }],
  },
  {
    type: 'video', format: 'unified', label: 'Unified Video',
    description: '兼容 /v1/video/create 与 /v1/video/query 的聚合视频格式。',
    defaultBaseUrl: 'https://api.example.com', defaultModel: 'veo3.1-pro', modelRequired: true,
    extraFields: [{ key: 'nativeAudio', label: '支持原生音画', kind: 'boolean', defaultValue: 'true' }],
  },
  {
    type: 'video', format: 'volcengine', label: '火山引擎 CV / Seedance',
    description: 'Volc4 签名的火山 CV 格式；Base URL 可填写同格式中转商。',
    defaultBaseUrl: 'https://visual.volcengineapi.com', defaultModel: 'seedance', modelRequired: false,
    extraFields: [
      { key: 'secretKey', label: 'Secret Access Key', kind: 'secret', required: true },
      { key: 'region', label: 'Region', kind: 'text', defaultValue: 'cn-north-1' },
      { key: 'service', label: 'Service', kind: 'text', defaultValue: 'cv' },
      { key: 'nativeAudio', label: '支持原生音画', kind: 'boolean', defaultValue: 'true' },
    ],
  },
  {
    type: 'audio', format: 'openai', label: 'OpenAI Audio Speech',
    description: '兼容 /v1/audio/speech 的 OpenAI、New API 及 TTS 中转站。',
    defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini-tts', modelRequired: true,
    extraFields: [{ key: 'voice', label: '默认音色', kind: 'text', defaultValue: 'alloy' }],
  },
  {
    type: 'audio', format: 'volcengine', label: '火山引擎 TTS v1',
    description: '火山语音 /api/v1/tts 格式；Base URL 可填写同格式中转商。',
    defaultBaseUrl: 'https://openspeech.bytedance.com', defaultModel: '', modelRequired: false,
    extraFields: [
      { key: 'appId', label: 'App ID', kind: 'text', required: true },
      { key: 'cluster', label: 'Cluster', kind: 'text', defaultValue: 'volcano_tts' },
      { key: 'voice', label: '默认音色', kind: 'text', defaultValue: 'BV001_streaming' },
    ],
  },
] as const;

export function getApiChannelFormat(type: ApiChannelType, format: string): ApiChannelFormatDefinition | undefined {
  return API_CHANNEL_FORMATS.find((item) => item.type === type && item.format === format);
}
