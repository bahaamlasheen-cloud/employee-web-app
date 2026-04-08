import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://tmyacneqvgkklpyzkvpb.supabase.co";
const supabaseKey = "sb_publishable_IZawtl7HPIlQZTrH-ZS-ZA_i3znihI4";

export const supabase = createClient(supabaseUrl, supabaseKey);