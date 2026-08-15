//#region lib/types/invariant.js
/** Package-owned invariant companion. @module @deepseek-ai/dsh-token-stats/invariant */
const PACKAGE_NAME = "@deepseek-ai/dsh-token-stats";
/** Cordis companion plugin name. */
const name = "dsh-token-stats-invariant";
/** Services required before the companion can reserve and check package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: the service is read-only aggregation over the
* authoritative session/event stream, and no second authority exists.
*/
const install = Object.assign(() => {}, { inject: ["tokenStats"] });
/**
* Register this package's invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
