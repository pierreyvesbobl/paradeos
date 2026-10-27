/**
 * À charger avant un script tsx qui importe des modules `server-only` :
 *
 *   NODE_OPTIONS="--import ./scripts/_lib/server-only-shim.mjs" pnpm tsx scripts/<x>.ts
 */
import { register } from "node:module";

register(new URL("./server-only-hooks.mjs", import.meta.url));
