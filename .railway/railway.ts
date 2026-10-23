import { defineRailway, github, project, service } from "railway/iac";
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "api";
export default defineRailway(() => {
  const _repoapi = service("@repo/api", {
    source: github("andrei-dyminski-apps/booking", {
      branch: "main",
      checkSuites: false,
    }),
    build: {
      buildCommand: "pnpm turbo run build --filter=@repo/api",
      buildEnvironment: "V3",
      builder: "RAILPACK",
      watchPatterns: [
        "apps/api/**",
        "packages/contracts/**",
        "packages/typescript-config/**",
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "turbo.json",
      ],
    },
    start: "node apps/api/dist/main",
    healthcheck: "/",
    preDeploy: "pnpm --filter @repo/api db:deploy",
    replicas: { "europe-west4-drams3a": 1 },
    networking: { privateNetworkEndpoint: "repoapi" },
  });

  return project("sincere-gentleness", {
    variables: { managed: false },
    resources: [_repoapi],
  });
});
