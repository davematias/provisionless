import { AccountClient } from "@aws-sdk/client-account";
import { ApiGatewayV2Client } from "@aws-sdk/client-apigatewayv2";
import { CloudFrontClient } from "@aws-sdk/client-cloudfront";
import { ResourceGroupsTaggingAPIClient } from "@aws-sdk/client-resource-groups-tagging-api";

/** AWS clients used by the read-only discovery commands. */
export interface DiscoveryClients {
  account: AccountClient;
  cloudfront: CloudFrontClient;
  tagging: (region: string) => ResourceGroupsTaggingAPIClient;
  apiGateway: (region: string) => ApiGatewayV2Client;
}

/** Creates the discovery clients, reusing per-region tagging and API Gateway clients. */
export function createDiscoveryClients(defaultRegion: string): DiscoveryClients {
  const tagging = new Map<string, ResourceGroupsTaggingAPIClient>();
  const apiGateway = new Map<string, ApiGatewayV2Client>();

  return {
    account: new AccountClient({ region: defaultRegion }),
    cloudfront: new CloudFrontClient({ region: "us-east-1" }),
    tagging: (region) => {
      const existing = tagging.get(region);
      if (existing) {
        return existing;
      }
      const client = new ResourceGroupsTaggingAPIClient({ region });
      tagging.set(region, client);
      return client;
    },
    apiGateway: (region) => {
      const existing = apiGateway.get(region);
      if (existing) {
        return existing;
      }
      const client = new ApiGatewayV2Client({ region });
      apiGateway.set(region, client);
      return client;
    },
  };
}
