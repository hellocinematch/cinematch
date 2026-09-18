import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabase";

const DELETE_CONFIRM_WORD = "DELETE";

/** Exact confirm token the Edge function and the Profile sheet both require. */
export function isDeleteAccountConfirm(value) {
  return String(value || "").trim() === DELETE_CONFIRM_WORD;
}

export { DELETE_CONFIRM_WORD };

/**
 * Wipe the signed-in account (circles transfer/leave, ratings, auth user).
 * Caller must already have collected the DELETE confirm in the UI.
 */
export async function deleteMyAccount() {
  const { data, error } = await supabase.functions.invoke("delete-account", {
    body: { confirm: DELETE_CONFIRM_WORD },
  });
  if (error) {
    let msg = error.message || "Could not delete account.";
    if (error instanceof FunctionsHttpError && error.context) {
      try {
        const errBody = await error.context.json();
        if (errBody && typeof errBody === "object" && typeof errBody.error === "string") {
          msg = errBody.error;
        }
      } catch {
        // keep generic
      }
    }
    throw new Error(msg);
  }
  if (data && typeof data === "object" && typeof data.error === "string") {
    throw new Error(data.error);
  }
  return data;
}
