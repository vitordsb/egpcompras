import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY precisam estar definidos no .env'
  );
}

// Cliente sem generic Database — quando o schema estabilizar, gerar tipos com:
//   pnpm dlx supabase gen types typescript --project-id <ref> > src/types/db.generated.ts
// e re-tipar este client.
export const supabase = createClient(url, anonKey);
