import { routeRequest } from "./http/router";
import type { Env } from "./types/env";

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return routeRequest(request, env);
  },
};
