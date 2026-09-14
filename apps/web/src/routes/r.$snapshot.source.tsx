import { createFileRoute, notFound } from '@tanstack/react-router';
import { z } from 'zod';
import { getSource } from '@/lib/catalog.functions';
import { SourceBrowser } from '@/components/source-browser';
export const Route = createFileRoute('/r/$snapshot/source')({
  validateSearch: z.object({
    file: z.string().max(200).optional(),
    view: z.enum(['project', 'html']).optional(),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ params, deps }) => {
    if (!/^[a-f0-9]{64}$/.test(params.snapshot)) throw notFound();
    const result = await getSource({
      data: { revision: params.snapshot, ...deps, view: deps.view ?? 'project' },
    });
    if (!result) throw notFound();
    return result;
  },
  component: () => <SourceBrowser source={Route.useLoaderData()} />,
});
