import { getJsonRpcFullnodeUrl, JsonRpcHTTPTransport } from "@mysten/sui/jsonRpc";

const buildNetwork = (network: "mainnet" | "testnet") => ({
  network,
  transport: new JsonRpcHTTPTransport({ url: getJsonRpcFullnodeUrl(network) }),
});

export const SUI_NETWORKS = {
  mainnet: buildNetwork("mainnet"),
  testnet: buildNetwork("testnet"),
} as const;

export type SuiNetwork = keyof typeof SUI_NETWORKS;

export const DEFAULT_NETWORK: SuiNetwork = "mainnet";
