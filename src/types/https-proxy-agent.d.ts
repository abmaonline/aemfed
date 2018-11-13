import { Agent } from "http";

declare class HttpsProxyAgent extends Agent {
  constructor(
    uri:
      | string
      | { protocol?: string; host?: string; hostname?: string; port?: string }
  );
}

export = HttpsProxyAgent;
