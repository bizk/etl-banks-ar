import { QueryClient } from '@tanstack/react-query';

// Data screens read from the local database, so queries and mutations must run whether or
// not the browser thinks it is online. Calls that do need the server simply fail offline.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 1,
      networkMode: 'always',
    },
    mutations: {
      networkMode: 'always',
    },
  },
});
