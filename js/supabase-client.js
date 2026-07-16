// Shared Supabase client — copy this exact file into each app repo (website, booking, management).
// Do not create a second client with `createClient()` anywhere else — one cached client per page,
// loaded through this file, avoids the dual-client localStorage bug we hit in the previous project.

const SUPABASE_URL = "https://mhoustvvwmwfovocwwna.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Pcy-RKj3z_jeUn1S5ODcGA_DloE6lFQ";

let _spacecoClient = null;

function getSpacecoClient() {
  if (!_spacecoClient) {
    _spacecoClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return _spacecoClient;
}

window.getSpacecoClient = getSpacecoClient;
