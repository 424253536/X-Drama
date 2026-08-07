import { afterEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { getDbDriver, resetDbDriver } from '@/lib/db-driver';
import {
  createGateway,
  createGatewayModel,
  listModelCatalog,
  listModelRoutingAdmin,
  loadModelRoutingIntoEnv,
  resolveModelRoutesSync,
  runModelRouteChain,
  updateGatewayModel,
  updateModelProfile,
  validateModelSelections,
} from '@/lib/model-routing';

const originalRoutes = process.env.QFMJ_RUNTIME_MODEL_ROUTES_V2;

afterEach(() => {
  if (originalRoutes == null) delete process.env.QFMJ_RUNTIME_MODEL_ROUTES_V2;
  else process.env.QFMJ_RUNTIME_MODEL_ROUTES_V2 = originalRoutes;
  resetDbDriver();
});

async function createFixture() {
  const suffix = nanoid(8);
  await createGateway({
    name: `Gateway A ${suffix}`, baseUrl: `https://a-${suffix}.test/v1`, apiKey: `sk-a-${suffix}`,
  }, 'admin-test');
  await createGateway({
    name: `Gateway B ${suffix}`, baseUrl: `https://b-${suffix}.test/v1`, apiKey: `sk-b-${suffix}`,
  }, 'admin-test');
  let state = await listModelRoutingAdmin();
  const gatewayA = state.gateways.find((item) => item.name === `Gateway A ${suffix}`)!;
  const gatewayB = state.gateways.find((item) => item.name === `Gateway B ${suffix}`)!;
  const modelKey = `seedance-${suffix}`;

  await createGatewayModel({
    gatewayId: gatewayA.id,
    profile: {
      modelKey, displayName: `Seedance ${suffix}`, mediaType: 'video',
      taskKinds: ['video.default', 'video.first_last_frame'],
      capabilities: { imageToVideo: true, firstLastFrame: true, nativeAudio: true },
    },
    upstreamModelId: `seedance-a-${suffix}`, protocol: 'openai-videos', priority: 20,
  });
  state = await listModelRoutingAdmin();
  const profile = state.profiles.find((item) => item.modelKey === modelKey)!;
  await createGatewayModel({
    gatewayId: gatewayB.id, modelProfileId: profile.id,
    upstreamModelId: `seedance-b-${suffix}`, protocol: 'volcengine-video-bearer', priority: 10,
  });
  await createGatewayModel({
    gatewayId: gatewayA.id,
    profile: {
      modelKey: `sora-${suffix}`, displayName: `Sora ${suffix}`, mediaType: 'video',
      taskKinds: ['video.default'],
    },
    upstreamModelId: `sora-${suffix}`, protocol: 'openai-videos', priority: 30,
  });
  await loadModelRoutingIntoEnv();
  return { gatewayA, gatewayB, modelKey };
}

describe('model routing v2', () => {
  it('supports many models per gateway and deduplicates one logical model across gateways', async () => {
    const { gatewayA, modelKey } = await createFixture();
    const state = await listModelRoutingAdmin();
    expect(state.models.filter((item) => item.gatewayId === gatewayA.id)).toHaveLength(2);
    expect(state.profiles.filter((item) => item.modelKey === modelKey)).toHaveLength(1);

    const catalog = await listModelCatalog('video.default', 'video');
    const selected = catalog.find((item) => item.modelKey === modelKey);
    expect(selected?.routeCount).toBe(2);
    expect(catalog.filter((item) => item.modelKey === modelKey)).toHaveLength(1);
  });

  it('sorts only the selected logical model routes by mapping priority', async () => {
    const { gatewayA, gatewayB, modelKey } = await createFixture();
    const routes = resolveModelRoutesSync(modelKey, 'video', 'video.default');
    expect(routes.map((item) => item.gateway.id)).toEqual([gatewayB.id, gatewayA.id]);
    expect(routes.map((item) => item.priority)).toEqual([10, 20]);
    expect(routes.every((item) => item.profile.modelKey === modelKey)).toBe(true);
  });

  it('validates task compatibility and never fails over after an uncertain submission', async () => {
    const { modelKey } = await createFixture();
    await expect(validateModelSelections({ 'video.default': modelKey })).resolves.toEqual({ 'video.default': modelKey });
    await expect(validateModelSelections({ 'audio.tts': modelKey })).rejects.toThrow(/不能用于|不可用/);

    const routes = resolveModelRoutesSync(modelKey, 'video', 'video.default');
    let attempts = 0;
    await expect(runModelRouteChain(routes, async () => {
      attempts++;
      throw new Error('REMOTE_TASK_CREATED task-123: query timeout');
    })).rejects.toThrow(/uncertain_submit/);
    expect(attempts).toBe(1);
  });

  it('records ordered gateway attempts without persisting gateway secrets', async () => {
    const { modelKey } = await createFixture();
    const routes = resolveModelRoutesSync(modelKey, 'video', 'video.default');
    const result = await runModelRouteChain(routes, async (_route, sequence) => {
      if (sequence === 1) throw new Error('HTTP 401 Unauthorized');
      return { videoUrl: 'https://asset.test/video.mp4', upstreamId: 'task-ok' };
    }, {
      operation: 'video.generate', taskKind: 'video.default', requestParameters: { durationSec: 5 },
    });
    expect(result.videoUrl).toContain('video.mp4');

    const call = await getDbDriver().get<{
      id: string; state: string; requested_model_key: string; ordered_routes_snapshot_json: string;
    }>('SELECT id, state, requested_model_key, ordered_routes_snapshot_json FROM ai_model_calls WHERE requested_model_key = ? ORDER BY created_at DESC LIMIT 1', [modelKey]);
    expect(call?.state).toBe('completed');
    const snapshotText = call?.ordered_routes_snapshot_json || '';
    expect(snapshotText).not.toContain('sk-a-');
    expect(snapshotText).not.toContain('sk-b-');
    expect(JSON.parse(snapshotText)).toHaveLength(2);

    const attempts = await getDbDriver().query<{ state: string }>(
      'SELECT state FROM ai_model_call_attempts WHERE model_call_id = ? ORDER BY sequence', [call!.id],
    );
    expect(attempts.map((item) => item.state)).toEqual(['failed', 'completed']);
  });

  it('persists per-mapping adapter options and preserves omitted profile policies', async () => {
    const { modelKey } = await createFixture();
    let state = await listModelRoutingAdmin();
    const profile = state.profiles.find((item) => item.modelKey === modelKey)!;
    const mapping = state.models.find((item) => item.modelProfileId === profile.id)!;

    await updateGatewayModel(mapping.id, {
      gatewayId: mapping.gatewayId,
      modelProfileId: mapping.modelProfileId,
      upstreamModelId: mapping.upstreamModelId,
      protocol: mapping.protocol,
      priority: mapping.priority,
      status: mapping.status,
      protocolOptions: { cluster: 'volcano_tts' },
      parametersOverride: { resolution: '720p' },
      pricingOverride: { cnyPerSecond: 0.25 },
      configVersion: mapping.configVersion,
    });
    await updateModelProfile(profile.id, {
      modelKey: profile.modelKey,
      displayName: profile.displayName,
      mediaType: profile.mediaType,
      pricingPolicy: { mode: 'route_override' },
      accessPolicy: { roles: ['admin'] },
      limits: { maxDurationSec: 10 },
      configVersion: profile.configVersion,
    });

    state = await listModelRoutingAdmin();
    const configured = state.profiles.find((item) => item.id === profile.id)!;
    await updateModelProfile(configured.id, {
      modelKey: configured.modelKey,
      displayName: `${configured.displayName} updated`,
      mediaType: configured.mediaType,
      configVersion: configured.configVersion,
    });
    state = await listModelRoutingAdmin();
    const rereadProfile = state.profiles.find((item) => item.id === profile.id)!;
    const rereadMapping = state.models.find((item) => item.id === mapping.id)!;
    expect(rereadProfile.pricingPolicy).toEqual({ mode: 'route_override' });
    expect(rereadProfile.accessPolicy).toEqual({ roles: ['admin'] });
    expect(rereadProfile.limits).toEqual({ maxDurationSec: 10 });
    expect(rereadMapping.protocolOptions).toEqual({ cluster: 'volcano_tts' });
    expect(rereadMapping.parametersOverride).toEqual({ resolution: '720p' });
    expect(rereadMapping.pricingOverride).toEqual({ cnyPerSecond: 0.25 });
  });

  it('rejects pinned routing while multiple mappings remain active', async () => {
    const { modelKey } = await createFixture();
    const state = await listModelRoutingAdmin();
    const profile = state.profiles.find((item) => item.modelKey === modelKey)!;
    await expect(updateModelProfile(profile.id, {
      modelKey: profile.modelKey,
      displayName: profile.displayName,
      mediaType: profile.mediaType,
      routePolicy: 'pinned',
      configVersion: profile.configVersion,
    })).rejects.toThrow(/只能保留一条/);
  });

  it('installs all v2 routing and call audit tables in SQLite', async () => {
    const rows = await getDbDriver().query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN
        ('api_gateways', 'ai_model_profiles', 'api_gateway_models', 'ai_model_calls', 'ai_model_call_attempts')`,
    );
    expect(rows.map((item) => item.name).sort()).toEqual([
      'ai_model_call_attempts', 'ai_model_calls', 'ai_model_profiles', 'api_gateway_models', 'api_gateways',
    ]);
  });
});
