import { getUser } from "@/lib/auth/server";
import type { User } from "@supabase/supabase-js";
import type { z } from "zod";

export type ActionError = {
  ok: false;
  code: "unauthorized" | "validation" | "internal";
  message: string;
  fieldErrors?: Record<string, string[]>;
};

export type ActionSuccess<T> = {
  ok: true;
  data: T;
};

export type ActionResult<T> = ActionSuccess<T> | ActionError;

type Handler<TInput, TOutput> = (args: { input: TInput; user: User }) => Promise<TOutput>;

type Options = {
  /** Si false, l'action est appelable sans user authentifié. */
  requireAuth?: boolean;
};

/**
 * Helper Server Action : valide le payload Zod, vérifie l'auth, exécute
 * le handler. Le handler reçoit le user typé (non-null) quand requireAuth.
 *
 * Usage côté composant :
 *   const result = await updateProfile({ fullName: "PY" });
 *   if (!result.ok) toast.error(result.message);
 */
export function action<TSchema extends z.ZodTypeAny, TOutput>(
  schema: TSchema,
  handler: Handler<z.infer<TSchema>, TOutput>,
  options: Options = {},
) {
  const requireAuth = options.requireAuth ?? true;

  return async (rawInput: unknown): Promise<ActionResult<TOutput>> => {
    const parsed = schema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        ok: false,
        code: "validation",
        message: "Données invalides.",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      };
    }

    let user: User | null = null;
    if (requireAuth) {
      user = await getUser();
      if (!user) {
        return { ok: false, code: "unauthorized", message: "Authentification requise." };
      }
    }

    try {
      const data = await handler({ input: parsed.data, user: user as User });
      return { ok: true, data };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur interne.";
      console.error("[action] handler error:", err);
      return { ok: false, code: "internal", message };
    }
  };
}
