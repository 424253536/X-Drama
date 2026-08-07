import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/app/api/auth/lib';
import { listModelCatalog, type ModelMediaType } from '@/lib/model-routing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user?.sub) return NextResponse.json({ message: '请先登录' }, { status: 401 });
  const taskKind = request.nextUrl.searchParams.get('taskKind') || undefined;
  const rawMedia = request.nextUrl.searchParams.get('mediaType');
  const mediaType = rawMedia && ['text', 'image', 'video', 'audio'].includes(rawMedia)
    ? rawMedia as ModelMediaType : undefined;
  const models = await listModelCatalog(taskKind, mediaType);
  return NextResponse.json({ models }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}
