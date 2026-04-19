/**
 * Turns `supabase.functions.invoke` errors into actionable copy for toasts.
 * @see `@supabase/functions-js` FunctionsFetchError / FunctionsHttpError / FunctionsRelayError
 */
export function formatFunctionsInvokeError(
  error: unknown,
  functionName?: string,
): string {
  if (error == null) return "Unknown error";
  if (typeof error !== "object") return String(error);

  const e = error as {
    name?: string;
    message?: string;
    context?: unknown;
  };
  const label = functionName ? ` “${functionName}”` : "";

  if (e.name === "FunctionsFetchError") {
    const ctx = e.context;
    const inner =
      ctx instanceof Error
        ? ctx.message
        : typeof ctx === "object" &&
            ctx != null &&
            "message" in ctx &&
            typeof (ctx as { message?: unknown }).message === "string"
          ? (ctx as { message: string }).message
          : "";
    const bits = [
      `Could not reach Edge Function${label}.`,
      inner && inner !== e.message ? `(${inner})` : "",
      "Deploy it to this project (supabase functions deploy), check VITE_SUPABASE_URL, and disable blockers for *.supabase.co.",
    ];
    return bits.filter(Boolean).join(" ");
  }

  if (e.name === "FunctionsRelayError") {
    return `Supabase relay could not run${label}. Deploy the function or try again later.`;
  }

  if (e.name === "FunctionsHttpError" && e.context instanceof Response) {
    const st = e.context.status;
    if (st === 404 && functionName) {
      return `Edge Function “${functionName}” is missing (HTTP 404). Deploy: supabase functions deploy ${functionName}`;
    }
    if (st === 401) {
      return `Not authorized (HTTP 401)${label}. Sign out and sign in again. If you changed VITE_SUPABASE_URL, clear site data for this site so old sessions are removed.`;
    }
    return `${e.message ?? "Edge Function error"} (HTTP ${st})${label}`;
  }

  return (e.message ?? "Request failed") + label;
}
