# End-to-end release gate

Unit and integration tests never provision AWS infrastructure, so a release can still break on
deploy steps that only fail against real AWS: IAM policy propagation, CloudFront distribution
changes, DynamoDB table activation, or a CLI that cannot find the deploy artifacts it needs. The
end-to-end gate closes that gap by deploying the upcoming CLI into a dedicated AWS test account,
checking the running API and admin site, and deleting the stack again.

The workflow is `.github/workflows/e2e-deploy.yml`.

## When it runs

| Trigger                                           | Behaviour                                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Pull request from `release-please--*` (same repo) | Deploys, verifies, tears down, and reports the required check.                     |
| Manual dispatch                                   | Same job, for a deliberate check or a retry on an allowed branch.                  |
| Any other pull request                            | The job is skipped; GitHub reports a skipped job as a successful check.            |
| Fork pull request or another branch               | The job cannot obtain AWS credentials; the environment only allows the refs below. |

`End-to-end deploy` is a required check in the `main checks` ruleset. Release pull requests cannot
merge until it passes. Skipped jobs count as successful for required checks, so ordinary pull
requests merge without running it.

## What the job does

1. Checks out the pull request commit, installs dependencies, and builds the CLI.
2. Builds the admin and API deploy artifacts from that commit and serves them from
   `http://127.0.0.1:8765`, so the CLI proves it can consume the releases it ships.
3. Packs the CLI, installs the tarball in an empty temporary project, and confirms the binary runs
   outside a source checkout.
4. Deploys into the test account with a unique `pv-e2e-<run>-<attempt>` prefix and
   `--no-domains`, which keeps the run free of DNS and certificate setup.
5. Verifies the deployed API serves `/openapi.json`, the seeded test user can sign in, and the
   CloudFront admin site returns a Content-Security-Policy that allows the deployed API origin
   plus working client assets.
6. Always runs `provisionless undeploy --no-keep-data --delete-logs`, then fails if any Lambda
   function or log group, S3 bucket, DynamoDB table, SQS queue, SNS topic, API Gateway API, IAM
   role, CloudFront distribution, or tagged deployment with the run prefix remains.

The job has a 90-minute timeout and a per-ref concurrency group, and every run uses its own prefix,
so overlapping runs cannot collide.

## One-time setup

### Dedicated AWS account

Use a separate account with no production data. Attach a budget alert, keep the account's root
credentials out of CI, and do not deploy anything else there. The gate creates and deletes real
resources; an isolated account keeps a failed teardown from affecting anything else.

Choose a region close to the repository's runners (for example `us-west-2`) and record the account
ID and region.

### GitHub OIDC provider and role

Create the GitHub OIDC provider in the test account (once per account):

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

Create a role that only the `e2e-deploy` environment can assume. The `sub` condition uses the
environment claim, so it does not matter whether the job came from a pull request or a manual
dispatch, and no other branch or repository can assume it:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<account-id>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:davematias/provisionless:environment:e2e-deploy"
        }
      }
    }
  ]
}
```

The role needs to manage the whole deployment stack. In a dedicated test account, attaching
`AdministratorAccess` is the simplest correct policy: the CLI creates IAM roles and policies,
CloudFront distributions, S3 buckets, DynamoDB tables, and more, and a narrower policy tends to fail
in the middle of a deploy. Do not reuse this role outside the test account. `provisionless deploy
--preflight` reports missing permissions before provisioning.

```bash
aws iam create-role \
  --role-name provisionless-e2e \
  --assume-role-policy-document file://trust-policy.json
aws iam attach-role-policy \
  --role-name provisionless-e2e \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
```

### GitHub environment

The job runs in the `e2e-deploy` environment. Only that environment issues the OIDC credentials, and
its branch policy limits which refs may use it:

```bash
gh api -X PUT repos/davematias/provisionless/environments/e2e-deploy \
  -F 'deployment_branch_policy[protected_branches]=false' \
  -F 'deployment_branch_policy[custom_branch_policies]=true'

gh variable set AWS_E2E_ROLE_ARN --repo davematias/provisionless --env e2e-deploy \
  --body arn:aws:iam::<account-id>:role/provisionless-e2e
gh variable set AWS_E2E_REGION --repo davematias/provisionless --env e2e-deploy \
  --body us-west-2

gh api -X POST repos/davematias/provisionless/environments/e2e-deploy/deployment-branch-policies \
  -f name=main -f type=branch
gh api -X POST repos/davematias/provisionless/environments/e2e-deploy/deployment-branch-policies \
  -f name='release-please--*' -f type=branch
```

With those policies, manual dispatches work only on `main`, and pull requests only from branches
starting with `release-please--`. Fork pull requests never reach the environment, so they cannot
obtain credentials. No environment secrets are needed; the role ARN and region are variables.

### Required check

Add `End-to-end deploy` to the `main checks` ruleset (Settings → Rules → `main checks` → Require
status checks → add the check). See [repository-settings.md](repository-settings.md) for the full
list and how to change it. If the job name in the workflow changes, update the ruleset in the same
change.

## Running it manually

```bash
gh workflow run e2e-deploy.yml --ref main
gh run watch
```

Manual dispatches are limited to `main` by the environment's branch policy. They use the same
teardown and leftover checks, so a failed run still cleans up after itself.

## Runtime and cost

Expect roughly 30–50 minutes: most of that is `npm ci`, the admin build, the first CloudFront
distribution rollout, and waiting for CloudFront to disable during teardown (up to 20 minutes).
The stack is deleted at the end, so there is no idle cost between runs. A typical run costs well
under US$1 in the test account, dominated by CloudFront, Lambda, and CloudWatch usage; GitHub-hosted
minutes are free for this public repository. Set a budget alert in the test account anyway.

## Troubleshooting

- **The job fails before deploying.** Check that `AWS_E2E_ROLE_ARN` and `AWS_E2E_REGION` are set on
  the `e2e-deploy` environment, and that the role's trust policy uses the
  `repo:davematias/provisionless:environment:e2e-deploy` subject.
- **`Could not assume role` on a branch or dispatch.** The environment branch policy rejected the
  ref. Manual dispatches must target `main`; pull requests must come from `release-please--*`
  branches in this repository.
- **Artifact download failures.** The job serves the freshly built assets from localhost and points
  `PROVISIONLESS_RELEASE_BASE_URL` at that server. Look for the artifact build step output and the
  local server log.
- **Leftover resources.** The teardown step retries the leftover check for about 90 seconds, then
  fails with the resource names. Run `provisionless undeploy --prefix pv-e2e-<run>-<attempt>
--no-keep-data --delete-logs` with the same credentials, or delete the named resources by hand.
- **CloudFront deletion is slow.** CloudFront distributions must finish disabling before they can be
  deleted. The job waits, within its timeout; do not cancel a run that is waiting on this step.
