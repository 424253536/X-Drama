import { registerVideoProvider } from './registry';
import type { VideoGenerateInput } from './types';
import { listRuntimeApiChannelsSync } from '@/lib/runtime-api-channels';

function references(input: VideoGenerateInput): string[] {
  return [
    ...(input.referenceImages || []),
    ...(input.subjectReferences || []).flatMap((subject) => [subject.imageUrl, ...(subject.refImageUrls || [])]),
  ].filter(Boolean);
}

registerVideoProvider({
  id: 'runtime-video-channels',
  name: '用户视频渠道链',
  priority: 20,
  supportsImage2Video: true,
  supportsText2Video: true,
  supportsLastFrame: false,
  supportsSubjectReference: true,
  supportsNativeAudio: true,
  maxDurationSec: 60,
  available: () => listRuntimeApiChannelsSync('video').length > 0,
  async generate(input) {
    const errors: string[] = [];
    for (const channel of listRuntimeApiChannelsSync('video')) {
      try {
        if (channel.format === 'volcengine') {
          const [{ SeedanceService, buildSeedanceOptionsFromInput }] = await Promise.all([
            import('@/services/seedance.service'),
          ]);
          const service = new SeedanceService({
            baseUrl: channel.baseUrl,
            accessKey: channel.apiKey,
            secretKey: channel.secrets.secretKey || '',
            region: String(channel.options.region || 'cn-north-1'),
            service: String(channel.options.service || 'cv'),
          });
          const result = await service.generateVideo(buildSeedanceOptionsFromInput({
            ...input,
            nativeAudio: Boolean(input.nativeAudio && channel.options.nativeAudio !== false),
          }));
          if (result.status !== 'success' || !result.videoUrl) throw new Error(result.error || '没有视频 URL');
          return { videoUrl: result.videoUrl, provider: `channel:${channel.id}`, upstreamId: result.taskId };
        }

        const { VeoService } = await import('@/services/veo.service');
        const service = new VeoService({
          apiKey: channel.apiKey,
          baseURL: channel.baseUrl,
          model: channel.model,
          format: channel.format === 'unified' ? 'unified' : 'openai',
          fallbackModels: [],
        });
        const prompt = input.nativeAudio && input.spokenDialogue && channel.options.nativeAudio !== false
          ? `${input.prompt}. Spoken line (voice this aloud): "${input.spokenDialogue}"`
          : input.prompt;
        const videoUrl = await service.generateVideo(input.firstFrameUrl || '', prompt, {
          duration: input.durationSec,
          resolution: input.resolution,
          aspectRatio: input.aspectRatio,
          style: input.style,
          referenceImages: references(input),
          nativeAudio: Boolean(input.nativeAudio && channel.options.nativeAudio !== false),
          onProgress: input.onProgress,
        });
        if (!videoUrl) throw new Error('没有视频 URL');
        return { videoUrl, provider: `channel:${channel.id}` };
      } catch (error) {
        errors.push(`${channel.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(errors.join(' | ') || '没有可用的自定义视频渠道');
  },
});

