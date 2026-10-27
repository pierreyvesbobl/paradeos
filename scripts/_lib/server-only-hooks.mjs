/**
 * Hook de résolution Node : `import "server-only"` devient un module vide.
 * Le paquet n'existe pas dans node_modules (Next le fournit en interne),
 * et il lève hors d'un contexte React Server. Enregistré par
 * `server-only-shim.mjs`, pour lancer avec tsx les modules `lib/` qui
 * s'en protègent.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { url: "data:text/javascript,", shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
