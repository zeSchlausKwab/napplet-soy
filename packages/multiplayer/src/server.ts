import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Matchmaking, joinSchema, ticketSchema, matchSchema } from './matchmaking';

export function createMatchmakingServer(service = new Matchmaking()) {
  const server = new McpServer({ name: 'napplet-space-matchmaking', version: '0.1.0' });
  const result = (operation: () => Record<string, unknown>) => {
    try {
      const value = operation();
      return {
        structuredContent: value,
        content: [{ type: 'text' as const, text: JSON.stringify(value) }],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: error instanceof Error ? error.message : 'Matchmaking failed',
          },
        ],
      };
    }
  };
  const actor = (meta: Record<string, unknown> | undefined) => {
    const pubkey = meta?.clientPubkey;
    if (typeof pubkey !== 'string') throw new Error('Authenticated ContextVM client required');
    return pubkey;
  };
  server.registerTool(
    'space_match_join',
    {
      description:
        'Join a queue for an exact napplet address and aggregate hash. Repeat joins are idempotent. Waiting tickets expire after 60 seconds without a status check.',
      inputSchema: joinSchema,
      outputSchema: matchSchema,
    },
    (args, extra) => result(() => service.join(actor(extra._meta), args)),
  );
  server.registerTool(
    'space_match_status',
    {
      description:
        'Check your own ticket and renew its waiting lease. A match lists peer transport pubkeys and a shared room ID. Poll at most once every two seconds.',
      inputSchema: ticketSchema,
      outputSchema: matchSchema,
    },
    (args, extra) => result(() => service.status(actor(extra._meta), args)),
  );
  server.registerTool(
    'space_match_leave',
    {
      description:
        'Leave your queue or match. Leaving a match closes it for the remaining peers. Idempotent.',
      inputSchema: ticketSchema,
      outputSchema: z.object({ left: z.boolean() }),
    },
    (args, extra) => result(() => service.leave(actor(extra._meta), args)),
  );
  return server;
}
