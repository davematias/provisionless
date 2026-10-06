import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DescribeCertificateCommand,
  ListCertificatesCommand,
  RequestCertificateCommand,
} from "@aws-sdk/client-acm";
import {
  ChangeResourceRecordSetsCommand,
  ListHostedZonesByNameCommand,
} from "@aws-sdk/client-route-53";
import { expect, it } from "vitest";

import type { AwsClients } from "../aws/clients.ts";
import { loadConfig, saveConfig } from "../config/config.ts";
import { ensureCertificates } from "./certificates.ts";
import type { DeployContext } from "./context.ts";

function tempRepo(): string {
  return mkdtempSync(join(tmpdir(), "provisionless-certs-"));
}

const noop = (): void => undefined;

interface ContextOptions {
  repoRoot: string;
  domains?: { adminDomain?: string; apiDomain?: string; hostedZone?: string };
  acm?: (command: unknown) => Promise<unknown>;
  acmUsEast1?: (command: unknown) => Promise<unknown>;
  route53?: (command: unknown) => Promise<unknown>;
  dryRun?: boolean;
  log?: (message: string) => void;
}

function createContext(options: ContextOptions): DeployContext {
  return {
    region: "eu-west-1",
    accountId: "111122223333",
    dryRun: options.dryRun ?? false,
    repoRoot: options.repoRoot,
    appPrefix: "demo",
    mediaBucket: "demo-media",
    adminDomain: options.domains?.adminDomain,
    apiDomain: options.domains?.apiDomain,
    hostedZone: options.domains?.hostedZone,
    log: options.log ?? noop,
    clients: {
      acm: { send: options.acm ?? (async () => ({})) },
      acmUsEast1: { send: options.acmUsEast1 ?? (async () => ({})) },
      route53: { send: options.route53 ?? (async () => ({})) },
    } as unknown as AwsClients,
  };
}

function issued(arn: string, domain: string): { Certificate: Record<string, unknown> } {
  return { Certificate: { CertificateArn: arn, DomainName: domain, Status: "ISSUED" } };
}

it("reuses saved certificate ARNs without requesting new certificates", async () => {
  const repo = tempRepo();
  saveConfig(repo, {
    appPrefix: "demo",
    adminDomain: "admin.example.com",
    apiDomain: "api.example.com",
    adminCertificateArn: "arn:admin",
    apiCertificateArn: "arn:api",
  });

  const acmCommands: unknown[] = [];
  const adminCommands: unknown[] = [];
  const route53Commands: unknown[] = [];

  const ctx = createContext({
    repoRoot: repo,
    domains: { adminDomain: "admin.example.com", apiDomain: "api.example.com" },
    acm: async (command) => {
      acmCommands.push(command);
      if (command instanceof DescribeCertificateCommand) {
        return issued("arn:api", "api.example.com");
      }
      return {};
    },
    acmUsEast1: async (command) => {
      adminCommands.push(command);
      if (command instanceof DescribeCertificateCommand) {
        return issued("arn:admin", "admin.example.com");
      }
      return {};
    },
    route53: async (command) => {
      route53Commands.push(command);
      return {};
    },
  });

  const result = await ensureCertificates(ctx, true);

  expect(result).toEqual({
    adminCertificateArn: "arn:admin",
    adminCertificateIssued: true,
    apiCertificateArn: "arn:api",
  });
  expect(acmCommands.some((command) => command instanceof RequestCertificateCommand)).toBe(false);
  expect(adminCommands.some((command) => command instanceof RequestCertificateCommand)).toBe(false);
  expect(route53Commands).toEqual([]);
});

it("finds and reuses an existing certificate for the domain", async () => {
  const repo = tempRepo();
  saveConfig(repo, { appPrefix: "demo", apiDomain: "api.example.com" });

  const commands: unknown[] = [];
  const ctx = createContext({
    repoRoot: repo,
    domains: { apiDomain: "api.example.com" },
    acm: async (command) => {
      commands.push(command);
      if (command instanceof ListCertificatesCommand) {
        return {
          CertificateSummaryList: [
            { CertificateArn: "arn:found", DomainName: "api.example.com", Status: "ISSUED" },
          ],
        };
      }
      if (command instanceof DescribeCertificateCommand) {
        return issued("arn:found", "api.example.com");
      }
      return {};
    },
  });

  const result = await ensureCertificates(ctx, true);

  expect(result.apiCertificateArn).toBe("arn:found");
  expect(commands.some((command) => command instanceof RequestCertificateCommand)).toBe(false);
  expect(loadConfig(repo)?.apiCertificateArn).toBe("arn:found");
});

it("requests a certificate and creates validation records in the hosted zone", async () => {
  const repo = tempRepo();
  saveConfig(repo, { appPrefix: "demo", apiDomain: "api.example.com", hostedZone: "Z0123456789" });

  const acmCommands: unknown[] = [];
  const route53Commands: unknown[] = [];
  let describes = 0;

  const ctx = createContext({
    repoRoot: repo,
    domains: { apiDomain: "api.example.com", hostedZone: "Z0123456789" },
    acm: async (command) => {
      acmCommands.push(command);
      if (command instanceof ListCertificatesCommand) {
        return { CertificateSummaryList: [] };
      }
      if (command instanceof RequestCertificateCommand) {
        return { CertificateArn: "arn:new" };
      }
      if (command instanceof DescribeCertificateCommand) {
        describes += 1;
        return describes === 1
          ? {
              Certificate: {
                CertificateArn: "arn:new",
                DomainName: "api.example.com",
                Status: "PENDING_VALIDATION",
                DomainValidationOptions: [
                  {
                    DomainName: "api.example.com",
                    ResourceRecord: {
                      Name: "_x.api.example.com.",
                      Type: "CNAME",
                      Value: "_y.acm-validations.aws.",
                    },
                  },
                ],
              },
            }
          : issued("arn:new", "api.example.com");
      }
      return {};
    },
    route53: async (command) => {
      route53Commands.push(command);
      return {};
    },
  });

  const result = await ensureCertificates(ctx, true);

  expect(result.apiCertificateArn).toBe("arn:new");
  expect(acmCommands.some((command) => command instanceof RequestCertificateCommand)).toBe(true);
  const change = route53Commands.find(
    (command) => command instanceof ChangeResourceRecordSetsCommand,
  ) as { input: { HostedZoneId?: string; ChangeBatch?: { Changes?: unknown[] } } } | undefined;
  expect(change?.input.HostedZoneId).toBe("Z0123456789");
  expect(change?.input.ChangeBatch?.Changes).toHaveLength(1);
  expect(loadConfig(repo)?.apiCertificateArn).toBe("arn:new");
});

it("prints validation records instead of creating them when no hosted zone is configured", async () => {
  const repo = tempRepo();
  saveConfig(repo, { appPrefix: "demo", apiDomain: "api.example.com" });

  const logs: string[] = [];
  const route53Commands: unknown[] = [];
  let describes = 0;

  const ctx = createContext({
    repoRoot: repo,
    domains: { apiDomain: "api.example.com" },
    log: (message) => logs.push(message),
    acm: async (command) => {
      if (command instanceof ListCertificatesCommand) {
        return { CertificateSummaryList: [] };
      }
      if (command instanceof RequestCertificateCommand) {
        return { CertificateArn: "arn:new" };
      }
      if (command instanceof DescribeCertificateCommand) {
        describes += 1;
        return {
          Certificate: {
            CertificateArn: "arn:new",
            DomainName: "api.example.com",
            Status: "PENDING_VALIDATION",
            DomainValidationOptions: [
              {
                DomainName: "api.example.com",
                ResourceRecord: {
                  Name: "_x.api.example.com.",
                  Type: "CNAME",
                  Value: "_y.acm-validations.aws.",
                },
              },
            ],
          },
        };
      }
      return {};
    },
    route53: async (command) => {
      route53Commands.push(command);
      return {};
    },
  });

  const result = await ensureCertificates(ctx, true);

  expect(result.apiCertificateArn).toBe("arn:new");
  expect(route53Commands).toEqual([]);
  expect(describes).toBe(1);
  expect(logs.some((message) => message.includes("_x.api.example.com."))).toBe(true);
  expect(logs.some((message) => message.includes("_y.acm-validations.aws."))).toBe(true);
});

it("requests a certificate covering apex and www names for the admin domain", async () => {
  const repo = tempRepo();
  saveConfig(repo, { appPrefix: "demo", adminDomain: "www.example.com" });

  const adminCommands: unknown[] = [];

  const ctx = createContext({
    repoRoot: repo,
    domains: { adminDomain: "www.example.com" },
    acmUsEast1: async (command) => {
      adminCommands.push(command);
      if (command instanceof ListCertificatesCommand) {
        return { CertificateSummaryList: [] };
      }
      if (command instanceof RequestCertificateCommand) {
        return { CertificateArn: "arn:san" };
      }
      if (command instanceof DescribeCertificateCommand) {
        return {
          Certificate: {
            CertificateArn: "arn:san",
            DomainName: "www.example.com",
            Status: "PENDING_VALIDATION",
            DomainValidationOptions: [
              {
                DomainName: "www.example.com",
                ResourceRecord: { Name: "_a.www.example.com.", Value: "_b.acm-validations.aws." },
              },
              {
                DomainName: "example.com",
                ResourceRecord: { Name: "_c.example.com.", Value: "_d.acm-validations.aws." },
              },
            ],
          },
        };
      }
      return {};
    },
  });

  const result = await ensureCertificates(ctx, true);

  expect(result.adminCertificateArn).toBe("arn:san");
  expect(result.adminCertificateIssued).toBe(false);
  const request = adminCommands.find((command) => command instanceof RequestCertificateCommand) as
    | { input: { DomainName?: string; SubjectAlternativeNames?: string[] } }
    | undefined;
  expect(request?.input.DomainName).toBe("www.example.com");
  expect(request?.input.SubjectAlternativeNames).toEqual(["example.com"]);
});

it("requests a new admin certificate when the saved one misses a redirect name", async () => {
  const repo = tempRepo();
  saveConfig(repo, {
    appPrefix: "demo",
    adminDomain: "example.com",
    adminCertificateArn: "arn:old",
  });

  const adminCommands: unknown[] = [];

  const ctx = createContext({
    repoRoot: repo,
    domains: { adminDomain: "example.com" },
    acmUsEast1: async (command) => {
      adminCommands.push(command);
      if (command instanceof DescribeCertificateCommand) {
        return {
          Certificate: {
            CertificateArn: "arn:old",
            DomainName: "example.com",
            SubjectAlternativeNames: ["example.com"],
            Status: "ISSUED",
          },
        };
      }
      if (command instanceof ListCertificatesCommand) {
        return { CertificateSummaryList: [] };
      }
      if (command instanceof RequestCertificateCommand) {
        return { CertificateArn: "arn:new" };
      }
      return {};
    },
  });

  const result = await ensureCertificates(ctx, true);

  expect(result.adminCertificateArn).toBe("arn:new");
  expect(adminCommands.some((command) => command instanceof RequestCertificateCommand)).toBe(true);
});

it("resolves a hosted zone name to its id", async () => {
  const repo = tempRepo();
  saveConfig(repo, { appPrefix: "demo", apiDomain: "api.example.com", hostedZone: "example.com" });

  const route53Commands: unknown[] = [];
  let describes = 0;

  const ctx = createContext({
    repoRoot: repo,
    domains: { apiDomain: "api.example.com", hostedZone: "example.com" },
    acm: async (command) => {
      if (command instanceof ListCertificatesCommand) {
        return { CertificateSummaryList: [] };
      }
      if (command instanceof RequestCertificateCommand) {
        return { CertificateArn: "arn:new" };
      }
      if (command instanceof DescribeCertificateCommand) {
        describes += 1;
        return describes === 1
          ? {
              Certificate: {
                CertificateArn: "arn:new",
                DomainName: "api.example.com",
                Status: "PENDING_VALIDATION",
                DomainValidationOptions: [
                  {
                    DomainName: "api.example.com",
                    ResourceRecord: {
                      Name: "_x.api.example.com.",
                      Type: "CNAME",
                      Value: "_y.acm-validations.aws.",
                    },
                  },
                ],
              },
            }
          : issued("arn:new", "api.example.com");
      }
      return {};
    },
    route53: async (command) => {
      route53Commands.push(command);
      if (command instanceof ListHostedZonesByNameCommand) {
        return { HostedZones: [{ Id: "/hostedzone/Z0ABC", Name: "example.com." }] };
      }
      return {};
    },
  });

  await ensureCertificates(ctx, true);

  const change = route53Commands.find(
    (command) => command instanceof ChangeResourceRecordSetsCommand,
  ) as { input: { HostedZoneId?: string } } | undefined;
  expect(change?.input.HostedZoneId).toBe("Z0ABC");
});

it("does not touch AWS when no domains are configured", async () => {
  const repo = tempRepo();
  let called = false;
  const ctx = createContext({
    repoRoot: repo,
    acm: async () => {
      called = true;
      return {};
    },
    acmUsEast1: async () => {
      called = true;
      return {};
    },
    route53: async () => {
      called = true;
      return {};
    },
  });

  const result = await ensureCertificates(ctx, true);

  expect(result).toEqual({ adminCertificateIssued: false });
  expect(called).toBe(false);
});

it("does not request certificates during a dry run", async () => {
  const repo = tempRepo();
  saveConfig(repo, { appPrefix: "demo", apiDomain: "api.example.com" });
  let called = false;

  const ctx = createContext({
    repoRoot: repo,
    domains: { apiDomain: "api.example.com", hostedZone: "Z0123456789" },
    dryRun: true,
    acm: async () => {
      called = true;
      return {};
    },
    route53: async () => {
      called = true;
      return {};
    },
  });

  await ensureCertificates(ctx, false);

  expect(called).toBe(false);
});
