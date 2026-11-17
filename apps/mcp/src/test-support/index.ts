import { z } from 'zod';

// Test helper: the parts of a JSON-RPC response from /mcp the tests look at, parsed (not cast).
const rpcBodySchema = z.object({
  id: z.number().optional(),
  result: z.object({
    serverInfo: z.object({ name: z.string() }).optional(),
    instructions: z.string().optional(),
    tools: z.array(z.object({ name: z.string() })).optional(),
    isError: z.boolean().optional(),
    content: z.array(z.object({ type: z.string(), text: z.string() })).optional(),
  }),
});

export type RPCBody = z.output<typeof rpcBodySchema>;

export const readRPCBody = async (response: Response): Promise<RPCBody> => rpcBodySchema.parse(await response.json());

export const toolText = (body: RPCBody): string => body.result.content?.[0]?.text ?? '';
