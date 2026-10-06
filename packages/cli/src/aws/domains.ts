export interface AdminSiteNames {
  canonical: string;
  redirectNames: string[];
  names: string[];
}

function labelCount(domain: string): number {
  return domain.split(".").length;
}

export function adminSiteNames(adminDomain: string): AdminSiteNames {
  const canonical = adminDomain.toLowerCase();
  const wwwMatch = /^www\.(.+)$/.exec(canonical);
  const redirectNames: string[] = [];
  if (wwwMatch?.[1]) {
    redirectNames.push(wwwMatch[1]);
  } else if (labelCount(canonical) === 2) {
    redirectNames.push(`www.${canonical}`);
  }
  return { canonical, redirectNames, names: [canonical, ...redirectNames] };
}
