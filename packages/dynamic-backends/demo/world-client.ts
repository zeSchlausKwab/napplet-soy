export type Cell = { x: number; y: number; z: number };
export type Chunk = { position: Cell; revision: number; blocks: number[] };
export type Target = {
  module: { napplet: string; name: string };
  release: string;
  instance?: string;
};
export type Intent = {
  target: Target;
  operation: string;
  input: Record<string, unknown>;
  requestId: string;
  expiresAt: number;
};
export const positions = Array.from({ length: 8 }, (_, i) => ({
  x: i % 2,
  y: Math.floor(i / 4),
  z: Math.floor(i / 2) % 2,
}));
export const chunkKey = (p: Cell) => [p.x, p.y, p.z].join(',');
export const positionFor = (p: Cell) => ({
  x: Math.floor(p.x / 8),
  y: Math.floor(p.y / 8),
  z: Math.floor(p.z / 8),
});
export const offsetFor = (p: Cell) => (p.x % 8) + 8 * ((p.z % 8) + 8 * (p.y % 8));
export function worldCode(target: Target) {
  return target.instance + '.' + target.release;
}
export function parseWorldCode(text: string, module: Target['module']): Target {
  const parts = text.trim().split('.');
  if (parts.length !== 2 || !/^[a-f0-9]{32}$/.test(parts[0]) || !/^[a-f0-9]{64}$/.test(parts[1]))
    throw new Error('Use the complete world code: world ID followed by its release.');
  return { module, instance: parts[0], release: parts[1] };
}
export function intent(target: Target, operation: string, input: Record<string, unknown>): Intent {
  return {
    target: { ...target },
    operation,
    input,
    requestId: crypto.randomUUID(),
    expiresAt: Math.floor(Date.now() / 1000) + 240,
  };
}
export class BackendFailure extends Error {
  constructor(
    message: string,
    readonly definitive: boolean,
  ) {
    super(message);
  }
}
export async function tool(name: string, args: unknown): Promise<any> {
  let response;
  try {
    response = await (window as any).napplet.cvm.registry.call('soy.backends.v1', name, args, {
      timeoutMs: 15000,
    });
  } catch (error) {
    throw new BackendFailure(
      error instanceof Error ? error.message : 'Connection interrupted.',
      false,
    );
  }
  const content =
    response.structuredContent ??
    JSON.parse(response.content?.find((x: any) => x.type === 'text')?.text ?? '{}');
  if (response.isError)
    throw new BackendFailure(
      content.error?.message ?? content.message ?? JSON.stringify(content),
      true,
    );
  return content;
}
