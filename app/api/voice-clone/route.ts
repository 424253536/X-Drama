/**
 * POST /api/voice-clone · 阶段三十 v12.39.0
 *
 * 上传角色音样 → 克隆出自定义 voice_id(MiniMax),之后填进角色配音即可跨集/跨语言保音色。
 * body: { sampleUrl:string(http,先经 /api/upload 落盘), voiceId?:string, name?:string }
 * 200 → { ok, voiceId, demoAudio?, note }
 *
 * 登录必需。诚实:本环境无音样未端到端验证(纯函数有测);voiceId 需 ≥8、字母数字、字母开头。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '../auth/lib';
import { isValidVoiceId, normalizeVoiceId } from '@/lib/voice-clone';
import { hasVoiceClone, cloneVoice } from '@/services/voice-clone.service';
import { persistAsset } from '@/lib/asset-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

export async function POST(request: NextRequest) {
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasVoiceClone()) return NextResponse.json({ error: '声音克隆未启用:需配置官方 MiniMax 端点 + MINIMAX_API_KEY' }, { status: 501 });

  // v12.208:直收 multipart 音样文件(前端无需先调独立上传端点)——落盘持久副本得 http URL 再克隆。
  // 保留旧 JSON { sampleUrl } 路径(外链音样)。
  let sampleUrl: string | undefined;
  let nameHint: string | undefined;
  let voiceIdHint: string | undefined;
  const ctype = request.headers.get('content-type') || '';
  if (ctype.includes('multipart/form-data')) {
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    nameHint = (form?.get('name') as string) || undefined;
    voiceIdHint = (form?.get('voiceId') as string) || undefined;
    if (!(file instanceof Blob)) return NextResponse.json({ error: '缺少音样文件 file' }, { status: 400 });
    if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: '音样需 ≤5MB' }, { status: 400 });
    const buf = Buffer.from(await file.arrayBuffer());
    const dataUri = `data:${(file as any).type || 'audio/mpeg'};base64,${buf.toString('base64')}`;
    const persisted = await persistAsset(dataUri, { ext: 'mp3', contentType: (file as any).type || 'audio/mpeg' });
    // persistAsset 返回站内 /api/serve-file?key= 相对 URL → 拼成绝对 http 供 MiniMax 拉取
    const rel = persisted?.url;
    if (!rel) return NextResponse.json({ error: '音样落盘失败' }, { status: 500 });
    const origin = new URL(request.url).origin;
    sampleUrl = rel.startsWith('http') ? rel : `${origin}${rel}`;
  } else {
    let body: { sampleUrl?: string; voiceId?: string; name?: string };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    sampleUrl = body.sampleUrl; nameHint = body.name; voiceIdHint = body.voiceId;
  }

  if (!sampleUrl || typeof sampleUrl !== 'string' || !/^https?:\/\//.test(sampleUrl)) {
    return NextResponse.json({ error: 'sampleUrl 必须是 http(s) URL(或上传 multipart 音样文件)' }, { status: 400 });
  }
  const voiceId = voiceIdHint && isValidVoiceId(voiceIdHint)
    ? voiceIdHint
    : normalizeVoiceId(nameHint || voiceIdHint || 'voice');

  try {
    const result = await cloneVoice({ sampleUrl, voiceId });
    return NextResponse.json({
      ok: true,
      voiceId: result.voiceId,
      demoAudio: result.demoAudio,
      note: '把这个 voiceId 填进角色配音(TTS voiceId)即可跨集/跨语言保住同一音色',
    });
  } catch (e) {
    return NextResponse.json({ error: (e instanceof Error ? e.message : String(e)).slice(0, 200) }, { status: 502 });
  }
}
