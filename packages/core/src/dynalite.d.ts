declare module "dynalite" {
  import type { AddressInfo } from "node:net";
  import type { Server } from "node:http";

  export interface DynaliteOptions {
    createTableMs?: number;
    updateTableMs?: number;
    deleteTableMs?: number;
  }

  export interface DynaliteServer extends Server {
    address(): AddressInfo | string | null;
  }

  function dynalite(options?: DynaliteOptions): DynaliteServer;

  export default dynalite;
}
