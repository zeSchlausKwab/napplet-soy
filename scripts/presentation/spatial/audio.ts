import { mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { DiagnosticError } from '../../../packages/diagnostics/src';
import { output, root } from './build';
import { spatialEffects } from './score';
import { DURATION } from './story';

async function ffmpeg(args: string[], target: string) {
  const process = Bun.spawn(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', ...args], {
    stdout: 'ignore',
    stderr: 'pipe',
  });
  const stderr = new Response(process.stderr).text();
  const exitCode = await process.exited;
  if (exitCode !== 0)
    throw new DiagnosticError('SPATIAL_AUDIO', 'Could not mix the presentation audio.', {
      tool: 'ffmpeg',
      exitCode,
      target,
      detail: await stderr,
      recovery: 'Check that the video and soundtrack can be decoded by FFmpeg, then retry.',
    });
}

/** Replaces all existing audio; never mixes the old synthesized music back in. */
export async function mixSpatialAudio(video = join(output, 'spatial-proof.mp4')) {
  if (!(await Bun.file(video).exists()))
    throw new DiagnosticError('SPATIAL_AUDIO', 'No rendered film to remix.', {
      target: video,
      recovery: 'Run bun run presentation:spatial:render first.',
    });
  const cache = join(root, '.local/spatial-proof');
  await mkdir(cache, { recursive: true });
  const effects = join(cache, 'effects.wav');
  const music = join(import.meta.dir, 'assets/soundtrack.mp3');
  const mix = join(cache, 'mix.wav');
  const temporary = join(cache, 'mixed-film.mp4');
  await spatialEffects(effects);
  await ffmpeg(
    [
      '-i',
      music,
      '-i',
      effects,
      '-filter_complex',
      `[0:a]aresample=48000,atrim=duration=${DURATION},asetpts=PTS-STARTPTS,volume=0.56,afade=t=out:st=29.8:d=0.2[music];` +
        '[1:a]asplit=2[effects][key];' +
        '[music][key]sidechaincompress=threshold=0.025:ratio=3:attack=5:release=160[bed];' +
        '[bed][effects]amix=inputs=2:normalize=0,alimiter=limit=0.8913:level=0:latency=1[mix]',
      '-map',
      '[mix]',
      '-t',
      String(DURATION),
      '-c:a',
      'pcm_s16le',
      mix,
    ],
    mix,
  );
  await ffmpeg(
    [
      '-i',
      mix,
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      join(output, 'story-audio.m4a'),
    ],
    join(output, 'story-audio.m4a'),
  );
  for (const [audio, target] of [
    [effects, join(output, 'spatial-effects.mp4')],
    [mix, temporary],
  ]) {
    await ffmpeg(
      [
        '-i',
        video,
        '-i',
        audio,
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-t',
        String(DURATION),
        '-movflags',
        '+faststart',
        target,
      ],
      target,
    );
  }
  await rename(temporary, join(output, 'spatial-proof.mp4'));
  console.log(
    'Audio replaced: supplied music + stronger game effects. Effects-only film also exported.',
  );
}
