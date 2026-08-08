import { NextRequest } from 'next/server';
import { isDemoMode } from '@/services/demo-orchestrator';
import { AgentRole } from '@/types/agents';
import { now } from '@/lib/db';
import { getDbDriver } from '@/lib/db-driver';
import { nanoid } from 'nanoid';
import { requireProjectAccess } from '@/lib/auth-guard';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 从数据库加载最近 N 条该 agent 的对话历史,供 LLM 维持上下文 */
async function loadChatHistory(projectId: string, agentRole: string, limit = 10): Promise<Array<{ role: string; content: string }>> {
  try {
    const rows = await getDbDriver().query(
      `SELECT role, content FROM chat_messages
       WHERE project_id = ? AND agent_role = ?
       ORDER BY created_at DESC LIMIT ?`,
      [projectId, agentRole, limit],
    ) as Array<{ role: string; content: string }>;
    return rows.reverse();
  } catch (e) {
    console.warn('[chat] loadChatHistory failed:', e);
    return [];
  }
}

/** 持久化用户消息 / 助手消息 */
async function saveChatMessage(projectId: string, agentRole: string, role: 'user' | 'assistant', content: string): Promise<void> {
  try {
    await getDbDriver().run(
      `INSERT INTO chat_messages (id, project_id, agent_role, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [nanoid(), projectId, agentRole, role, content, now()],
    );
  } catch (e) {
    console.warn('[chat] saveChatMessage failed:', e);
  }
}

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return (parsed ?? fallback) as T;
  } catch { return fallback; }
}

async function loadProjectChatContext(projectId: string, requestedRole: string) {
  const project = await getDbDriver().get<{
    title: string; status: string; model_selections_json: string | null;
  }>(
    'SELECT title, status, model_selections_json FROM projects WHERE id = ?',
    [projectId],
  );
  const rows = await getDbDriver().query<{
    type: string; name: string; data: string; media_urls: string | null; shot_number: number | null;
  }>(
    `SELECT type, name, data, media_urls, shot_number FROM project_assets
     WHERE project_id = ? AND type IN ('script', 'character', 'scene', 'storyboard', 'video')
     ORDER BY type, shot_number`,
    [projectId],
  );
  const byType = (type: string) => rows.filter((row) => row.type === type);
  const scriptRow = byType('script')[0];
  const scriptData = scriptRow ? parseJson<any>(scriptRow.data, {}) : undefined;
  const characters = byType('character').map((row) => ({ name: row.name, data: parseJson(row.data, {}) }));
  const scenes = byType('scene').map((row) => ({ name: row.name, ...parseJson<Record<string, unknown>>(row.data, {}) }));
  const storyboards = byType('storyboard').map((row) => ({
    name: row.name, shotNumber: row.shot_number, ...parseJson<Record<string, unknown>>(row.data, {}),
  }));
  const videos = byType('video').map((row) => {
    const data = parseJson<Record<string, any>>(row.data, {});
    const mediaUrls = parseJson<string[]>(row.media_urls, []);
    return { name: row.name, shotNumber: row.shot_number, data, mediaUrls };
  });
  const completedVideos = videos.filter((video) =>
    video.mediaUrls.some((url) => /^(https?:|\/api\/serve-file)/.test(url)),
  );

  let activeAgent: any = null;
  try {
    const { activeOrchestrators } = await import('@/lib/create-pipeline');
    const orchestrator = activeOrchestrators.get(projectId);
    const agents = orchestrator?.getAllAgents() || [];
    activeAgent = agents.find((agent) => agent.role === requestedRole)
      || agents.find((agent) => ['working', 'thinking'].includes(agent.status));
  } catch { /* inline runtime may be on another instance */ }

  const lastVideoError = await getDbDriver().get<{ error_summary: string | null }>(
    `SELECT error_summary FROM ai_model_calls
     WHERE project_id = ? AND task_kind = 'video.default' AND state IN ('failed', 'uncertain')
     ORDER BY created_at DESC LIMIT 1`,
    [projectId],
  ).catch(() => null);
  const videoCallStats = await getDbDriver().get<{ completed: number; failed: number }>(
    `SELECT
       SUM(CASE WHEN state = 'completed' THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN state IN ('failed', 'uncertain') THEN 1 ELSE 0 END) AS failed
     FROM ai_model_calls WHERE project_id = ? AND task_kind = 'video.default'`,
    [projectId],
  ).catch(() => null);
  const selections = parseJson<Record<string, string>>(project?.model_selections_json, {});
  const expectedVideos = Array.isArray(scriptData?.shots) && scriptData.shots.length > 0
    ? scriptData.shots.length
    : storyboards.length;
  const completedVideoCount = Math.min(
    expectedVideos || Number.MAX_SAFE_INTEGER,
    Math.max(completedVideos.length, Number(videoCallStats?.completed) || 0),
  );
  const assetFailureCount = videos.filter((video) => video.data?.status === 'error' || video.data?.status === 'failed').length;

  return {
    projectTitle: project?.title,
    scriptData,
    characters,
    scenes,
    storyboards,
    videos,
    modelKey: selections['text.default'] || selections['text.creative'],
    progressSnapshot: {
      projectStatus: project?.status || '处理中',
      expectedVideos,
      completedVideos: completedVideoCount,
      animaticVideos: completedVideos.filter((video) => video.data?.isAnimatic).length,
      failedVideos: assetFailureCount,
      failedAttempts: Number(videoCallStats?.failed) || 0,
      activeRole: activeAgent?.role,
      activeStatus: activeAgent?.status,
      activeTask: activeAgent?.currentTask,
      activeProgress: typeof activeAgent?.progress === 'number' ? activeAgent.progress : undefined,
      lastError: lastVideoError?.error_summary || undefined,
    },
  };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  // v12.230(鉴权复扫收口):v12.218「鉴权总修」只修了对抗报告点名的端点,未系统复扫
  // projects/[id]/** —— 本路由当时漏网,任何人知道 projectId 即可调用。
  const _g = await requireProjectAccess(request, projectId, 'edit');
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });

  const { agentRole, message: rawMessage } = await request.json();

  if (!rawMessage?.trim()) {
    return new Response(JSON.stringify({ error: '消息不能为空' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // v2.13.4: agent chat 也走安全闸门 + 上下文增强(让 LLM 知道这是项目内 chat,不是通用助手)
  const { checkAndSanitize } = await import('@/lib/prompt-guardrails');
  const verdict = checkAndSanitize(rawMessage, { task: 'chat' });
  if (!verdict.ok) {
    console.warn(`[chat] guardrail blocked: ${verdict.category}/${verdict.reason}`);
    return new Response(
      JSON.stringify({ error: verdict.userMessage, category: verdict.category }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  // 拉项目标题给 prompt 增强
  let projectTitle: string | undefined = undefined;
  try {
    const row = await getDbDriver().get('SELECT title FROM projects WHERE id = ?', [projectId]) as { title?: string } | undefined;
    projectTitle = row?.title || undefined;
  } catch { /* ignore */ }
  const { enhanceChatMessage } = await import('@/lib/prompt-templates');
  const message = enhanceChatMessage(verdict.sanitized, projectTitle);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: string, data: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`));
      };

      try {
        let chatService: any;
        const projectContext = await loadProjectChatContext(projectId, agentRole);
        const demoMode = isDemoMode() && !projectContext.modelKey;

        if (demoMode) {
          const { DemoChatService } = await import('@/services/agent-chat.service');
          chatService = new DemoChatService();
        } else {
          const { AgentChatService } = await import('@/services/agent-chat.service');
          chatService = new AgentChatService();
        }

        // 从数据库加载最近 10 条该 agent 的对话历史,维持上下文
        const chatHistory = await loadChatHistory(projectId, agentRole, 10);
        const context = {
          projectId,
          chatHistory,
          ...projectContext,
        };

        // 记录用户消息（非 demo 模式）
        if (!demoMode) {
          await saveChatMessage(projectId, agentRole, 'user', message);
        }

        const generator = chatService.chat(agentRole as AgentRole, message, context);

        let assistantReply = '';
        for await (const chunk of generator) {
          if (chunk.type === 'content') assistantReply += chunk.content || '';
          send(chunk.type, chunk.type === 'action' ? { action: chunk.action } : { content: chunk.content || '' });
        }

        // 记录助手回复
        if (!demoMode && assistantReply.trim()) {
          await saveChatMessage(projectId, agentRole, 'assistant', assistantReply);
        }
      } catch (error) {
        send('content', { content: `出错了: ${error instanceof Error ? error.message : '未知错误'}` });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
