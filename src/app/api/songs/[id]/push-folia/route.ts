import { deliverSong } from '@/lib/song-delivery';
import { foliaWebUrl } from '@/lib/folia-stage';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await deliverSong(id, { pushToFolia: true });

  if (!result.bundle) {
    return Response.json(
      { ok: false, error: result.stageSkippedReason ?? '歌曲尚未完成，无法推送' },
      { status: 409 },
    );
  }

  if (result.stage && !result.stage.ok) {
    return Response.json(
      {
        ok: false,
        error: result.stage.error ?? 'Folia Stage 推送失败',
        stage: result.stage,
        foliaWebUrl: result.stage.foliaWebUrl,
      },
      { status: 502 },
    );
  }

  if (!result.stage) {
    return Response.json(
      {
        ok: false,
        error: result.stageSkippedReason ?? 'Folia Stage 不可达',
        foliaWebUrl: foliaWebUrl(),
      },
      { status: 503 },
    );
  }

  return Response.json({
    ok: true,
    stage: result.stage,
    foliaWebUrl: result.stage.foliaWebUrl,
    localDirectory: result.bundle.directory,
  });
}
