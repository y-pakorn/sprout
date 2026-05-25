export type SuiNetwork = "mainnet" | "testnet";

export const DEFAULT_NETWORK: SuiNetwork = "mainnet";

/** gRPC (gRPC-web) fullnode endpoints for the new @mysten/sui 2.0 client. */
export const GRPC_URLS: Record<SuiNetwork, string> = {
  mainnet: "https://fullnode.mainnet.sui.io:443",
  testnet: "https://fullnode.testnet.sui.io:443",
};
