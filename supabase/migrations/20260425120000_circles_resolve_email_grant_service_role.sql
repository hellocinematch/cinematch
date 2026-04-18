-- =============================================================================
-- OPTIONAL follow-up — only if you already ran an older 20260424120000 WITHOUT the
-- `grant execute ... to service_role` line for resolve_profile_id_by_email.
--
-- If the SQL editor says:
--   ERROR: function public.resolve_profile_id_by_email(text) does not exist
-- then this file is NOT what you need. Run the FULL Phase B helpers migration instead:
--
--   supabase/migrations/20260424120000_circles_phase_b_helpers.sql
--
-- That file creates BOTH helpers (resolve_profile_id_by_email + get_my_pending_invites),
-- applies the revokes, and grants execute to service_role. Paste the entire file and run once.
-- =============================================================================

grant execute on function public.resolve_profile_id_by_email(text) to service_role;
