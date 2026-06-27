import { Capacitor } from '@capacitor/core'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** Native: implicit tokens in redirect hash (Safari hands off to app). Web: PKCE. */
const authFlowType = Capacitor.isNativePlatform() ? 'implicit' : 'pkce'

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    detectSessionInUrl: true,
    flowType: authFlowType,
  },
})
