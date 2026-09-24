import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    scrollRestorationBehavior: 'instant',
    defaultHashScrollIntoView: { behavior: 'instant', block: 'start' },
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 30_000,
  });
}
declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
