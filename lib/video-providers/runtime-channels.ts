import { registerVideoProvider } from './registry';
import type { VideoGenerateInput } from './types';
import { listRuntimeApiChannelsSync } from '@/lib/runtime-api-channels';
import {
  listRuntimeModelRoutesSync,
  mergeRouteParameters,
  resolveModelRoutesSync,
  runModelRouteChain,
  type RuntimeModelRoute,
} from '@/lib/model-routing';

function references(input: VideoGenerateInput): string[] {
  return [
    ...(input.referenceImages || []),
    ...(input.subjectReferences || []).flatMap((subject) => [subject.imageUrl, ...(subject.refImageUrls || [])]),
  ].filter(Boolean);
}

function actionUrl(baseUrl: string, action: string, override?: string | null): string {
  const url = override
    ? new URL(override, `${baseUrl.replace(/\/+$/, '')}/`)
    : new URL(baseUrl);
  url.searchParams.set('Action', action);
  url.searchParams.set('Version', '2022-08-31');
  return url.toString();
}

async function generateVolcengineBearer(route: RuntimeModelRoute, input: VideoGenerateInput) {
  const {
    SeedanceService,
    buildSeedanceOptionsFromInput,
    extractTaskId,
    parseTaskResult,
  } = await import('@/services/seedance.service');
  const parameters = mergeRouteParameters(route, {
    duration: input.durationSec,
    resolution: input.resolution,
    aspectRatio: input.aspectRatio,
  });
  const options = {
    ...buildSeedanceOptionsFromInput(input),
    ...parameters,
  } as any;
  const builder = new SeedanceService({ accessKey: 'unused', secretKey: 'unused', baseUrl: route.gateway.baseUrl });
  const { body } = builder.buildPayload(options);
  const submitBody = {
    ...body,
    model: route.upstreamModelId,
    req_key: route.upstreamModelId,
  };
  const headers = { Authorization: `Bearer ${route.gateway.apiKey}`, 'Content-Type': 'application/json' };
  const submitResponse = await fetch(
    actionUrl(route.gateway.baseUrl, 'CVSync2AsyncSubmitTask', route.endpointPathOverride),
    {
      method: 'POST',
      headers,
      body: JSON.stringify(submitBody),
      signal: AbortSignal.timeout(route.gateway.timeoutMs),
    },
  );
  const submitPayload = await submitResponse.json().catch(() => null);
  if (!submitResponse.ok) {
    throw new Error(submitPayload?.error?.message || submitPayload?.message || `HTTP ${submitResponse.status}`);
  }
  const taskId = extractTaskId(submitPayload);
  if (!taskId) throw new Error('火山格式响应中没有 task_id');

  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      const queryResponse = await fetch(actionUrl(route.gateway.baseUrl, 'CVSync2AsyncGetResult', route.endpointPathOverride), {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: route.upstreamModelId, req_key: route.upstreamModelId, task_id: taskId }),
        signal: AbortSignal.timeout(Math.min(route.gateway.timeoutMs, 30_000)),
      });
      const queryPayload = await queryResponse.json().catch(() => null);
      if (!queryResponse.ok) {
        throw new Error(queryPayload?.error?.message || queryPayload?.message || `HTTP ${queryResponse.status}`);
      }
      const result = parseTaskResult(taskId, queryPayload);
      input.onProgress?.(Math.min(0.95, (attempt + 1) / 60), `seedance: ${result.status}`);
      if (result.status === 'success' && result.videoUrl) {
        return { videoUrl: result.videoUrl, upstreamId: taskId };
      }
      if (result.status === 'failed') throw new Error(result.error || '火山视频任务失败');
    }
    throw new Error('火山视频任务轮询超时，远端任务状态不确定');
  } catch (error) {
    throw new Error(`REMOTE_TASK_CREATED ${taskId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function generateMappedVideo(route: RuntimeModelRoute, input: VideoGenerateInput) {
  if (route.protocol === 'volcengine-video-bearer') {
    return generateVolcengineBearer(route, input);
  }
  if (route.protocol === 'volcengine-video-signed') {
    throw new Error('签名模式需要独立 AK/SK 密钥配置；NewAPI 中转请使用 volcengine-video-bearer');
  }
  const { VeoService } = await import('@/services/veo.service');
  const parameters = mergeRouteParameters(route, {
    duration: input.durationSec,
    resolution: input.resolution,
    aspectRatio: input.aspectRatio,
  });
  const service = new VeoService({
    apiKey: route.gateway.apiKey,
    baseURL: route.gateway.baseUrl,
    model: route.upstreamModelId,
    format: route.protocol === 'unified-video' ? 'unified' : 'openai',
    fallbackModels: [],
  });
  const prompt = input.nativeAudio && input.spokenDialogue
    ? `${input.prompt}. Spoken line (voice this aloud): "${input.spokenDialogue}"`
    : input.prompt;
  let submittedTaskId = '';
  let videoUrl: string;
  try {
    videoUrl = await service.generateVideo(input.firstFrameUrl || '', prompt, {
      duration: Number(parameters.duration || input.durationSec),
      resolution: String(parameters.resolution || input.resolution || '') || undefined,
      aspectRatio: String(parameters.aspectRatio || input.aspectRatio || '') || undefined,
      style: input.style,
      referenceImages: references(input),
      lastFrameUrl: input.lastFrameUrl,
      nativeAudio: Boolean(input.nativeAudio),
      onProgress: input.onProgress,
      onTaskCreated: (taskId) => { submittedTaskId = taskId; },
    });
  } catch (error) {
    if (submittedTaskId) {
      throw new Error(`REMOTE_TASK_CREATED ${submittedTaskId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    throw error;
  }
  if (!videoUrl) throw new Error('没有视频 URL');
  return { videoUrl, upstreamId: submittedTaskId || undefined };
}

registerVideoProvider({
  id: 'runtime-video-channels',
  name: '用户视频渠道链',
  priority: 20,
  supportsImage2Video: true,
  supportsText2Video: true,
  supportsLastFrame: true,
  supportsSubjectReference: true,
  supportsNativeAudio: true,
  maxDurationSec: 60,
  available: () => listRuntimeModelRoutesSync('video').length > 0 || listRuntimeApiChannelsSync('video').length > 0,
  async generate(input) {
    if (input.modelKey) {
      const routes = resolveModelRoutesSync(input.modelKey, 'video', input.taskKind || 'video.default');
      const result = await runModelRouteChain(routes, (route) => generateMappedVideo(route, input), {
        operation: 'video.generate', taskKind: input.taskKind || 'video.default',
        projectId: input.projectId, userId: input.userId,
        requestParameters: {
          durationSec: input.durationSec, resolution: input.resolution, aspectRatio: input.aspectRatio,
          hasFirstFrame: !!input.firstFrameUrl, hasLastFrame: !!input.lastFrameUrl,
          referenceImageCount: references(input).length, nativeAudio: !!input.nativeAudio,
        },
      });
      return { ...result, provider: `model:${input.modelKey}` };
    }

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
