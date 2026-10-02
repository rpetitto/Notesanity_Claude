import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/**
 * In-app back that respects where the user actually came from.
 *
 * A hardcoded "back" link throws away the trail: opening a notebook, switching
 * to its assignments tab and clicking through to an assignment used to dump the
 * teacher back at the notebook list. Going back through real history returns to
 * the previous screen — including the tab it was on, since tab state lives in the
 * query string. The fallback only applies when the app was entered directly on
 * this URL and there is no history to pop.
 */
export function useBackTo(fallback: string) {
  const navigate = useNavigate();
  const location = useLocation();

  return useCallback(() => {
    // React Router stamps a key on every entry it created; "default" means this
    // was the first entry in the session, so there is nothing of ours to pop.
    if (location.key && location.key !== "default") navigate(-1);
    else navigate(fallback, { replace: true });
  }, [navigate, location.key, fallback]);
}
