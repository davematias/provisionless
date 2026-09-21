export interface ApiResourceNames {
  role: string;
  function: string;
  api: string;
  usersTable: string;
}

export interface AdminResourceNames {
  assetsBucket: string;
  tagCacheTable: string;
  revalidationQueue: string;
  role: string;
  serverFunction: string;
  imageFunction: string;
  revalidationFunction: string;
  distributionComment: string;
  s3Oac: string;
  lambdaOac: string;
}

export function apiNames(appPrefix: string): ApiResourceNames {
  return {
    role: `${appPrefix}-api-role`,
    function: `${appPrefix}-api`,
    api: `${appPrefix}-api`,
    usersTable: `${appPrefix}-users`,
  };
}

export function adminNames(appPrefix: string, accountId: string): AdminResourceNames {
  return {
    assetsBucket: `${appPrefix}-admin-assets-${accountId}`,
    tagCacheTable: `${appPrefix}-admin-tag-cache`,
    revalidationQueue: `${appPrefix}-admin-revalidation.fifo`,
    role: `${appPrefix}-admin-lambda-role`,
    serverFunction: `${appPrefix}-admin-server`,
    imageFunction: `${appPrefix}-admin-image`,
    revalidationFunction: `${appPrefix}-admin-revalidation`,
    distributionComment: `${appPrefix}-admin`,
    s3Oac: `${appPrefix}-admin-s3`,
    lambdaOac: `${appPrefix}-admin-lambda`,
  };
}

export function isValidAppPrefix(prefix: string): boolean {
  return /^[a-z][a-z0-9-]{1,28}$/.test(prefix);
}

export function mediaBucketName(appPrefix: string, name: string): string {
  const trimmed = name.trim().toLowerCase();
  if (trimmed.startsWith(`${appPrefix}-`)) {
    return trimmed;
  }
  return `${appPrefix}-${trimmed}`;
}

export function isValidBucketName(bucket: string): boolean {
  return /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) && !bucket.includes("..");
}
