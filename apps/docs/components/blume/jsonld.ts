interface Crumb {
  label: string;
  route?: string;
}

const normalizeBasePath = (input?: string): string => {
  if (!input) {
    return "";
  }
  const trimmed = input.trim().split("/").filter(Boolean).join("/");
  return trimmed === "" ? "" : `/${trimmed}`;
};

const isInternalPath = (target: string): boolean =>
  target.startsWith("/") && !target.startsWith("//");

const pathPart = (target: string): string => {
  const at = target.search(/[#?]/u);
  return at === -1 ? target : target.slice(0, at);
};

const isUnderBase = (base: string, route: string): boolean => {
  const path = pathPart(route);
  return path === base || path.startsWith(`${base}/`);
};

const withBasePath = (basePath: string, route: string): string => {
  if (!basePath || !isInternalPath(route) || isUnderBase(basePath, route)) {
    return route;
  }
  return route === "/" ? basePath : `${basePath}${route}`;
};

const mountBasePath = (basePath: string, route: string): string => {
  if (!basePath) {
    return route;
  }
  return route === "/" ? basePath : `${basePath}${route}`;
};

type DateInput = string | Date | null;

export interface PostalAddressIdentity {
  addressCountry?: string;
  addressLocality?: string;
  addressRegion?: string;
  postalCode?: string;
  streetAddress?: string;
}

export interface OrganizationIdentity {
  address?: PostalAddressIdentity;
  contactType: string;
  email?: string;
  logo?: string;
  name?: string;
  sameAs: string[];
  telephone?: string;
  url?: string;
}

export interface SoftwareIdentity {
  applicationCategory: string;
  description?: string;
  license?: string;
  name?: string;
  operatingSystem?: string;
  price?: number | string;
  priceCurrency: string;
  sameAs: string[];
}

export interface StructuredDataIdentity {
  organization?: OrganizationIdentity;
  software?: SoftwareIdentity;
}

export interface StructuredDataInput {
  siteName: string;
  siteUrl: string | null;
  title: string;
  description?: string;
  route: string;
  homeRoute?: string;
  base?: string;
  pageType?: string;
  published?: DateInput;
  modified?: DateInput;
  locale?: string;
  breadcrumbs: Crumb[];
  identity?: StructuredDataIdentity | null;
}

const ARTICLE_TYPES = {
  blog: "BlogPosting",
  changelog: "TechArticle",
} as const;

const isArticleType = (value: string): value is keyof typeof ARTICLE_TYPES =>
  Object.hasOwn(ARTICLE_TYPES, value);

type JsonLdValue = string | number | JsonLdValue[] | JsonLdNode;

export interface JsonLdNode {
  [key: string]: JsonLdValue;
}

const trimSlash = (value: string): string => value.replace(/\/$/u, "");

const absolute = (base: string | null, path: string): string =>
  base ? `${base}${path}` : path;

export const toIso = (value: DateInput | undefined): string | undefined => {
  if (!value) {
    return;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

const definedStrings = (
  source: Record<string, string | undefined>,
): JsonLdNode => {
  const node: JsonLdNode = {};
  for (const [key, value] of Object.entries(source)) {
    if (value) {
      node[key] = value;
    }
  }
  return node;
};

const organizationNode = (
  organization: OrganizationIdentity,
  context: {
    absolutize: (path: string) => string;
    id: string;
    rootUrl: string;
    siteName: string;
  },
): JsonLdNode => {
  const node: JsonLdNode = {
    "@id": context.id,
    "@type": "Organization",
    name: organization.name ?? context.siteName,
    url: organization.url ?? context.rootUrl,
  };
  if (organization.logo) {
    node.logo = context.absolutize(organization.logo);
  }
  if (organization.email) {
    node.email = organization.email;
  }
  if (organization.telephone) {
    node.telephone = organization.telephone;
  }
  if (organization.email || organization.telephone) {
    node.contactPoint = {
      "@type": "ContactPoint",
      contactType: organization.contactType,
      ...definedStrings({
        email: organization.email,
        telephone: organization.telephone,
      }),
    };
  }
  const address = organization.address
    ? definedStrings({ ...organization.address })
    : {};
  if (Object.keys(address).length > 0) {
    node.address = { "@type": "PostalAddress", ...address };
  }
  if (organization.sameAs.length > 0) {
    node.sameAs = organization.sameAs;
  }
  return node;
};

const softwareNode = (
  software: SoftwareIdentity,
  context: {
    description?: string;
    id: string;
    organizationId: string | null;
    rootUrl: string;
    siteName: string;
  },
): JsonLdNode => {
  const node: JsonLdNode = {
    "@id": context.id,
    "@type": "SoftwareApplication",
    applicationCategory: software.applicationCategory,
    name: software.name ?? context.siteName,
    url: context.rootUrl,
  };
  const description = software.description ?? context.description;
  if (description) {
    node.description = description;
  }
  if (software.operatingSystem) {
    node.operatingSystem = software.operatingSystem;
  }
  if (software.price !== undefined) {
    node.offers = {
      "@type": "Offer",
      price: String(software.price),
      priceCurrency: software.priceCurrency,
    };
  }
  if (software.license) {
    node.license = software.license;
  }
  if (software.sameAs.length > 0) {
    node.sameAs = software.sameAs;
  }
  if (context.organizationId) {
    node.publisher = { "@id": context.organizationId };
  }
  return node;
};

const pageSchemaType = (input: StructuredDataInput, home: boolean): string => {
  if (home) {
    return "WebPage";
  }
  const pageType = input.pageType ?? "";
  return isArticleType(pageType) ? ARTICLE_TYPES[pageType] : "TechArticle";
};

const pageNode = (
  input: StructuredDataInput,
  context: {
    base: string | null;
    home: boolean;
    organizationId: string | null;
    pageUrl: string;
  },
): JsonLdNode => {
  const node: JsonLdNode = {
    "@id": `${context.pageUrl}#page`,
    "@type": pageSchemaType(input, context.home),
    inLanguage: input.locale || "en",
    name: input.title,
    url: context.pageUrl,
  };
  if (!context.home) {
    node.headline = input.title;
  }
  if (input.description) {
    node.description = input.description;
  }
  const published = toIso(input.published);
  if (published) {
    node.datePublished = published;
  }
  const modified = toIso(input.modified);
  if (modified) {
    node.dateModified = modified;
  }
  if (context.base) {
    node.isPartOf = { "@id": `${context.base}#website` };
  }
  if (context.organizationId) {
    node.publisher = { "@id": context.organizationId };
  }
  return node;
};

const breadcrumbNode = (
  breadcrumbs: Crumb[],
  base: string | null,
  deployBase: string,
): JsonLdNode | null => {
  const linked = breadcrumbs.filter(
    (crumb): crumb is Required<Crumb> => typeof crumb.route === "string",
  );
  if (linked.length <= 1) {
    return null;
  }
  return {
    "@type": "BreadcrumbList",
    itemListElement: linked.map((crumb, index) => ({
      "@type": "ListItem",
      item: absolute(base, mountBasePath(deployBase, crumb.route)),
      name: crumb.label,
      position: index + 1,
    })),
  };
};

export const buildStructuredData = (input: StructuredDataInput): JsonLdNode => {
  const base = input.siteUrl ? trimSlash(input.siteUrl) : null;
  const deployBase = normalizeBasePath(input.base);
  const pageUrl = absolute(base, mountBasePath(deployBase, input.route));
  const rootUrl = absolute(base, deployBase);
  const graph: JsonLdNode[] = [];

  const organization = base ? input.identity?.organization : undefined;
  const software = base ? input.identity?.software : undefined;
  const organizationId = organization ? `${base}#organization` : null;

  if (base) {
    const website: JsonLdNode = {
      "@id": `${base}#website`,
      "@type": "WebSite",
      name: input.siteName,
      url: rootUrl,
    };
    if (organizationId) {
      website.publisher = { "@id": organizationId };
    }
    graph.push(website);
  }
  if (organization && organizationId) {
    graph.push(
      organizationNode(organization, {
        absolutize: (path) =>
          path.startsWith("/")
            ? absolute(base, withBasePath(deployBase, path))
            : path,
        id: organizationId,
        rootUrl,
        siteName: input.siteName,
      }),
    );
  }

  const home = input.route === (input.homeRoute ?? "/");
  graph.push(pageNode(input, { base, home, organizationId, pageUrl }));
  if (home) {
    if (software && base) {
      graph.push(
        softwareNode(software, {
          description: input.description,
          id: `${base}#software`,
          organizationId,
          rootUrl,
          siteName: input.siteName,
        }),
      );
    }
  } else {
    const breadcrumbs = breadcrumbNode(input.breadcrumbs, base, deployBase);
    if (breadcrumbs) {
      graph.push(breadcrumbs);
    }
  }

  return { "@context": "https://schema.org", "@graph": graph };
};
