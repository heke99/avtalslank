declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};
declare module "npm:@supabase/supabase-js@2.110.7" {
  export { createClient, type SupabaseClient } from "@supabase/supabase-js";
}
