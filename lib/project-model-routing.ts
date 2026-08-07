import { getDbDriver } from './db-driver';
import { loadModelRoutingIntoEnv, type AudioStrategy, type ModelSelections } from './model-routing';

interface ProjectRoutingRow {
  user_id: string;
  model_selections_json: string | null;
  routing_version: number | null;
  audio_strategy: string | null;
}

interface RoutingAwareOrchestrator {
  setModelSelections(selections: ModelSelections): void;
  setAudioStrategy(strategy: AudioStrategy): void;
  setProjectId(id: string): void;
  setUserId(id: string): void;
}

function parseSelections(raw: string | null): ModelSelections {
  try {
    const parsed = JSON.parse(raw || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const selections: ModelSelections = {};
    for (const [taskKind, modelKey] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof modelKey === 'string' && modelKey) selections[taskKind] = modelKey;
    }
    return selections;
  } catch {
    return {};
  }
}

/** Reuse the project's immutable model choices for single-shot regeneration and repair tools. */
export async function applyProjectModelRouting(
  orchestrator: RoutingAwareOrchestrator,
  projectId: string,
): Promise<ModelSelections> {
  const row = await getDbDriver().get<ProjectRoutingRow>(
    `SELECT user_id, model_selections_json, routing_version, audio_strategy
       FROM projects WHERE id = ?`, [projectId],
  );
  if (!row) return {};
  orchestrator.setProjectId(projectId);
  if (row.user_id) orchestrator.setUserId(row.user_id);
  const selections = Number(row.routing_version || 1) === 2 ? parseSelections(row.model_selections_json) : {};
  if (Object.keys(selections).length) {
    await loadModelRoutingIntoEnv();
    orchestrator.setModelSelections(selections);
  }
  const strategy: AudioStrategy = row.audio_strategy === 'native' || row.audio_strategy === 'hybrid'
    ? row.audio_strategy : 'separate';
  orchestrator.setAudioStrategy(strategy);
  return selections;
}
