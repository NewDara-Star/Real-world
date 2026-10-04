import { MAX_LAYERS } from "../shared/protocol";

export { Zone } from "./zone";

interface Env {
  ZONE: DurableObjectNamespace;
  ASSETS: Fetcher;
}

const ZONES = new Set(["yaba", "finglas"]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      const zone = url.searchParams.get("zone") ?? "yaba";
      const layer = Number(url.searchParams.get("layer") ?? 1);
      if (!ZONES.has(zone) || !Number.isInteger(layer) || layer < 1 || layer > MAX_LAYERS) {
        return new Response("unknown zone", { status: 404 });
      }
      const stub = env.ZONE.get(env.ZONE.idFromName(`${zone}-${layer}`));
      return stub.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
