"use client";

import { createDAppKit } from "@mysten/dapp-kit-react";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { GRPC_URLS, DEFAULT_NETWORK, type SuiNetwork } from "@/lib/sui";

/**
 * Single dApp Kit instance for the app — wires the new @mysten/sui 2.0 gRPC
 * client through @mysten/dapp-kit-react (the legacy @mysten/dapp-kit is
 * JSON-RPC-only and deprecated). Reads go through `useCurrentClient().core.*`;
 * signing through `useDAppKit().signAndExecuteTransaction`.
 */
export const dAppKit = createDAppKit({
  networks: ["mainnet", "testnet"],
  defaultNetwork: DEFAULT_NETWORK,
  autoConnect: true,
  createClient(network) {
    return new SuiGrpcClient({
      network,
      baseUrl: GRPC_URLS[network as SuiNetwork],
    });
  },
  slushWalletConfig: { appName: "Sprout" },
});

// Global type registration so the hooks infer the correct network/client types.
declare module "@mysten/dapp-kit-react" {
  interface Register {
    dAppKit: typeof dAppKit;
  }
}
