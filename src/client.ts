import type { BeverModel, EntityMetadata, EntityModel } from "./model.js";
import { joinUrl, normalizePrefix } from "./routes.js";
import { parseBeverModel, validateBeverModel } from "./validation.js";

export interface BeverClientOptions {
  baseUrl?: string;
  apiPrefix?: string;
  metadataPrefix?: string;
  fetch?: FetchLike;
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  antiforgeryToken?: string | (() => string | undefined | Promise<string | undefined>);
  model?: BeverModel;
}

export interface BeverClient {
  getModel(options?: RequestOptions): Promise<BeverModel>;
  listEntities(options?: RequestOptions): Promise<EntityMetadata[]>;
  getEntity(entityRoute: string, options?: RequestOptions): Promise<EntityModel>;
  list<TRecord = BeverRecord>(entityRoute: string, options?: RequestOptions): Promise<TRecord[]>;
  get<TRecord = BeverRecord>(entityRoute: string, id: string, options?: RequestOptions): Promise<TRecord>;
  create<TRecord = BeverRecord>(entityRoute: string, values: Record<string, unknown>, options?: RequestOptions): Promise<TRecord>;
  patch<TRecord = BeverRecord>(entityRoute: string, id: string, values: Record<string, unknown>, options?: RequestOptions): Promise<TRecord>;
  delete(entityRoute: string, id: string, options?: RequestOptions): Promise<void>;
  lookupReferences(entityRoute: string, request?: ReferenceLookupRequest, options?: RequestOptions): Promise<ReferenceLookupResponse>;
  hydrateReferences(entityRoute: string, request: ReferenceHydrationRequest, options?: RequestOptions): Promise<ReferenceHydrationResponse>;
  loadDropdownReferences(entityRoute: string, options?: RequestOptions): Promise<ReferenceLookupResponse>;
  login?: (request: IdentityCredentialRequest, options?: RequestOptions) => Promise<IdentitySession>;
  logout?: (options?: RequestOptions) => Promise<void>;
  getSession?: (options?: RequestOptions) => Promise<IdentitySession>;
  register?: (request: IdentityCredentialRequest, options?: RequestOptions) => Promise<IdentitySession>;
  /** Administrators only, and only when the model declares roles. */
  listAccounts?: (request?: IdentityAccountsRequest, options?: RequestOptions) => Promise<IdentityAccountsResponse>;
  /** Replaces an account's roles. Administrators only, and only when the model declares roles. */
  setAccountRoles?: (id: string, roles: string[], options?: RequestOptions) => Promise<IdentityAccount>;
  lookupIdentities(context: IdentityLookupContext, request?: ReferenceLookupRequest, options?: RequestOptions): Promise<ReferenceLookupResponse>;
  hydrateIdentities(context: IdentityLookupContext, request: ReferenceHydrationRequest, options?: RequestOptions): Promise<ReferenceHydrationResponse>;
}

export interface RequestOptions {
  signal?: AbortSignal;
  headers?: HeadersInit;
}

/** `_labels` maps each set single-target relationship field to its target's label, or null when the caller may not see it. */
export type BeverRecord = Record<string, unknown> & { id?: string; _labels?: Record<string, string | null> };

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ReferenceSummary { id: string; label: string }
export interface ReferenceLookupRequest { search?: string; limit?: number; cursor?: string; picker?: string }
export interface ReferenceLookupResponse { items: ReferenceSummary[]; nextCursor: string | null }
export interface ReferenceHydrationRequest { ids: string[] }
export interface ReferenceHydrationResponse { items: ReferenceSummary[] }
export interface IdentityCredentialRequest { email: string; password: string }
export interface IdentitySummary { id: string; label: string }
/** The current sign-in. Administrators may perform every action regardless of the model's rules; `roles` are the declared roles the account holds. */
export interface IdentitySession { authenticated: boolean; identity: IdentitySummary | null; administrator: boolean; roles: string[] }
export interface IdentityAccount { id: string; label: string; administrator: boolean; roles: string[] }
export type IdentityAccountsRequest = Omit<ReferenceLookupRequest, "picker">;
export interface IdentityAccountsResponse { items: IdentityAccount[]; nextCursor: string | null }
export interface IdentityLookupContext { entityRoute: string; field: string; action: "Create" | "Update"; id?: string }

export class BeverHttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly body: unknown;

  constructor(response: Response, body: unknown) {
    super(`Bever API request failed with ${response.status} ${response.statusText}.`);
    this.name = "BeverHttpError";
    this.status = response.status;
    this.statusText = response.statusText;
    this.body = body;
  }
}

export function createBeverClient(options: BeverClientOptions = {}): BeverClient {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (fetchImpl === undefined) {
    throw new Error("createBeverClient requires a fetch implementation in this environment.");
  }

  const baseUrl = options.baseUrl ?? "";
  const apiPrefix = normalizePrefix(options.apiPrefix ?? "/api/v1");
  const metadataPrefix = normalizePrefix(options.metadataPrefix ?? "/_bever");
  const model = options.model === undefined ? undefined : validateBeverModel(options.model);
  const identityCapabilities = new Set(model?.identity.enabled ? model.identity.capabilities : []);

  async function request<T>(path: string, init: RequestInit = {}, requestOptions: RequestOptions = {}, decode?: (response: Response) => Promise<T>): Promise<T> {
    const response = await fetchImpl(joinUrl(baseUrl, path), {
      ...init,
      signal: requestOptions.signal,
      credentials: init.credentials ?? "include",
      headers: await mergeHeaders(options.headers, stateChanging(init.method) ? await antiforgeryHeader(options.antiforgeryToken) : undefined, init.headers, requestOptions.headers)
    });

    if (!response.ok) {
      throw new BeverHttpError(response, await readBody(response));
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return decode === undefined ? (await response.json()) as T : decode(response);
  }

  const client: BeverClient = {
    getModel(requestOptions) {
      return request<BeverModel>(`${metadataPrefix}/model`, undefined, requestOptions, async response => parseBeverModel(await response.text()));
    },
    listEntities(requestOptions) {
      return request<EntityMetadata[]>(`${metadataPrefix}/entities`, undefined, requestOptions);
    },
    getEntity(entityRoute, requestOptions) {
      return request<EntityModel>(`${metadataPrefix}/entities/${encodeURIComponent(entityRoute)}`, undefined, requestOptions);
    },
    list(entityRoute, requestOptions) {
      return request(`${apiPrefix}/${encodeURIComponent(entityRoute)}`, undefined, requestOptions);
    },
    get(entityRoute, id, requestOptions) {
      return request(`${apiPrefix}/${encodeURIComponent(entityRoute)}/${encodeURIComponent(id)}`, undefined, requestOptions);
    },
    create(entityRoute, values, requestOptions) {
      return request(`${apiPrefix}/${encodeURIComponent(entityRoute)}`, jsonRequest("POST", values), requestOptions);
    },
    patch(entityRoute, id, values, requestOptions) {
      return request(`${apiPrefix}/${encodeURIComponent(entityRoute)}/${encodeURIComponent(id)}`, jsonRequest("PATCH", values), requestOptions);
    },
    delete(entityRoute, id, requestOptions) {
      return request(`${apiPrefix}/${encodeURIComponent(entityRoute)}/${encodeURIComponent(id)}`, { method: "DELETE" }, requestOptions);
    },
    lookupReferences(entityRoute, lookupRequest = {}, requestOptions) {
      const bounded = validateLookupRequest(lookupRequest);
      const search = new URLSearchParams();
      if (bounded.search !== undefined) search.set("search", bounded.search);
      if (bounded.limit !== undefined) search.set("limit", String(bounded.limit));
      if (bounded.cursor !== undefined) search.set("cursor", bounded.cursor);
      if (bounded.picker !== undefined) search.set("picker", bounded.picker);
      const query = search.toString();
      return request(`${apiPrefix}/${encodeURIComponent(entityRoute)}/_lookup${query.length === 0 ? "" : `?${query}`}`, undefined, requestOptions, async response => validateLookupResponse(await response.json()));
    },
    hydrateReferences(entityRoute, hydrationRequest, requestOptions) {
      const body = validateHydrationRequest(hydrationRequest);
      return request(`${apiPrefix}/${encodeURIComponent(entityRoute)}/_lookup/hydrate`, jsonRequest("POST", body), requestOptions, async response => validateHydrationResponse(await response.json()));
    },
    loadDropdownReferences(entityRoute, requestOptions) {
      return this.lookupReferences(entityRoute, { limit: 50 }, requestOptions);
    },
    lookupIdentities(context, lookupRequest = {}, requestOptions) {
      const bounded = validateLookupRequest(lookupRequest);
      const search = new URLSearchParams({ action: context.action });
      if (bounded.search !== undefined) search.set("search", bounded.search);
      if (bounded.limit !== undefined) search.set("limit", String(bounded.limit));
      if (bounded.cursor !== undefined) search.set("cursor", bounded.cursor);
      return request(`${identityLookupPath(apiPrefix, context)}?${search}`, undefined, requestOptions, async response => validateLookupResponse(await response.json()));
    },
    hydrateIdentities(context, hydrationRequest, requestOptions) {
      const body = validateHydrationRequest(hydrationRequest);
      return request(`${identityLookupPath(apiPrefix, context)}/hydrate?action=${encodeURIComponent(context.action)}`, jsonRequest("POST", body), requestOptions, async response => validateHydrationResponse(await response.json()));
    }
  };
  if (identityCapabilities.has("Login")) {
    client.login = (loginRequest, requestOptions) =>
      request(`${apiPrefix}/_identity/login`, jsonRequest("POST", validateCredentialRequest(loginRequest)), requestOptions, async response => validateSession(await response.json()));
  }
  if (identityCapabilities.has("Logout")) {
    client.logout = requestOptions => request(`${apiPrefix}/_identity/logout`, jsonRequest("POST", {}), requestOptions);
  }
  if (identityCapabilities.has("Session")) {
    client.getSession = requestOptions => request(`${apiPrefix}/_identity/session`, undefined, requestOptions, async response => validateSession(await response.json()));
  }
  if (identityCapabilities.has("Register")) {
    client.register = (registerRequest, requestOptions) =>
      request(`${apiPrefix}/_identity/register`, jsonRequest("POST", validateCredentialRequest(registerRequest)), requestOptions, async response => validateSession(await response.json()));
  }
  if (model !== undefined && model.roles.length > 0) {
    const declared = model.roles.map(role => role.name);
    client.listAccounts = (accountsRequest = {}, requestOptions) => {
      if ("picker" in accountsRequest) throw new BeverApiContractError("Account lists take no picker.");
      const bounded = validateLookupRequest(accountsRequest);
      const search = new URLSearchParams();
      if (bounded.search !== undefined) search.set("search", bounded.search);
      if (bounded.limit !== undefined) search.set("limit", String(bounded.limit));
      if (bounded.cursor !== undefined) search.set("cursor", bounded.cursor);
      const query = search.toString();
      return request(`${apiPrefix}/_identity/accounts${query.length === 0 ? "" : `?${query}`}`, undefined, requestOptions, async response => validateAccounts(await response.json()));
    };
    client.setAccountRoles = (id, roles, requestOptions) => {
      if (typeof id !== "string" || id.length === 0) throw new BeverApiContractError("Account id must be a nonempty string.");
      if (!Array.isArray(roles) || roles.some(role => !declared.includes(role)) || new Set(roles).size !== roles.length) throw new BeverApiContractError("Account roles must be declared role names, each once.");
      return request(`${apiPrefix}/_identity/accounts/${encodeURIComponent(id)}`, jsonRequest("PATCH", { roles }), requestOptions, async response => validateAccount(await response.json()));
    };
  }
  return client;
}

export class BeverApiContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BeverApiContractError";
  }
}

function validateLookupRequest(request: ReferenceLookupRequest): ReferenceLookupRequest {
  const keys = Object.keys(request) as Array<keyof ReferenceLookupRequest>;
  for (const key of keys) if (!["search", "limit", "cursor", "picker"].includes(key)) throw new BeverApiContractError(`Unsupported lookup request property '${String(key)}'.`);
  if (request.picker !== undefined && (typeof request.picker !== "string" || !/^[A-Za-z][A-Za-z0-9]*$/.test(request.picker))) throw new BeverApiContractError("Lookup picker must be an identifier.");
  if (request.search !== undefined && (typeof request.search !== "string" || [...request.search].length > 200)) throw new BeverApiContractError("Lookup search must be a string of at most 200 Unicode scalar values.");
  if (request.cursor !== undefined && (typeof request.cursor !== "string" || request.cursor.length > 2048 || !/^[\x00-\x7F]*$/.test(request.cursor))) throw new BeverApiContractError("Lookup cursor must be ASCII text of at most 2048 characters.");
  if (request.limit !== undefined && (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 50)) throw new BeverApiContractError("Lookup limit must be an integer from 1 through 50.");
  return request;
}

function validateHydrationRequest(request: ReferenceHydrationRequest): ReferenceHydrationRequest {
  if (request === null || typeof request !== "object" || Array.isArray(request)) throw new BeverApiContractError("Hydration request must be an object.");
  for (const key of Object.keys(request)) if (key !== "ids") throw new BeverApiContractError(`Unsupported hydration request property '${key}'.`);
  if (!Array.isArray(request.ids) || request.ids.length === 0 || request.ids.length > 50) throw new BeverApiContractError("Hydration ids must contain 1 through 50 IDs.");
  for (const id of request.ids) if (typeof id !== "string" || id.length === 0 || [...id].length > 256) throw new BeverApiContractError("Hydration IDs must be nonempty strings of at most 256 Unicode scalar values.");
  return request;
}

function validateLookupResponse(value: unknown): ReferenceLookupResponse {
  const object = closedObject(value, ["items", "nextCursor"], "lookup response");
  if (!Array.isArray(object.items)) throw new BeverApiContractError("Lookup response items must be an array.");
  const items = object.items.map(validateSummary);
  if (object.nextCursor !== null && typeof object.nextCursor !== "string") throw new BeverApiContractError("Lookup response nextCursor must be a string or null.");
  return { items, nextCursor: object.nextCursor };
}

function validateHydrationResponse(value: unknown): ReferenceHydrationResponse {
  const object = closedObject(value, ["items"], "hydration response");
  if (!Array.isArray(object.items)) throw new BeverApiContractError("Hydration response items must be an array.");
  return { items: object.items.map(validateSummary) };
}

function validateCredentialRequest(request: IdentityCredentialRequest): IdentityCredentialRequest {
  const object = closedObject(request, ["email", "password"], "identity credential request");
  if (typeof object.email !== "string" || typeof object.password !== "string") throw new BeverApiContractError("Identity credential request must contain email and password strings.");
  return { email: object.email, password: object.password };
}

function validateSession(value: unknown): IdentitySession {
  const object = closedObject(value, ["authenticated", "identity", "administrator", "roles"], "identity session");
  if (typeof object.authenticated !== "boolean") throw new BeverApiContractError("Identity session authenticated must be a boolean.");
  if (typeof object.administrator !== "boolean") throw new BeverApiContractError("Identity session administrator must be a boolean.");
  const identity = object.identity === null ? null : validateSummary(object.identity);
  return { authenticated: object.authenticated, identity, administrator: object.administrator, roles: validateRoleNames(object.roles, "Identity session") };
}

function validateAccounts(value: unknown): IdentityAccountsResponse {
  const object = closedObject(value, ["items", "nextCursor"], "account list");
  if (!Array.isArray(object.items)) throw new BeverApiContractError("Account list items must be an array.");
  if (object.nextCursor !== null && typeof object.nextCursor !== "string") throw new BeverApiContractError("Account list nextCursor must be a string or null.");
  return { items: object.items.map(validateAccount), nextCursor: object.nextCursor };
}

function validateAccount(value: unknown): IdentityAccount {
  const object = closedObject(value, ["id", "label", "administrator", "roles"], "account");
  if (typeof object.id !== "string" || typeof object.label !== "string" || typeof object.administrator !== "boolean") throw new BeverApiContractError("Account must contain string id and label and a boolean administrator.");
  return { id: object.id, label: object.label, administrator: object.administrator, roles: validateRoleNames(object.roles, "Account") };
}

function validateRoleNames(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some(role => typeof role !== "string")) throw new BeverApiContractError(`${name} roles must be an array of strings.`);
  return value;
}

function validateSummary(value: unknown): ReferenceSummary {
  const object = closedObject(value, ["id", "label"], "reference summary");
  if (typeof object.id !== "string" || typeof object.label !== "string") throw new BeverApiContractError("Reference summary must contain string id and label.");
  return { id: object.id, label: object.label };
}

function closedObject(value: unknown, allowed: string[], name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new BeverApiContractError(`${name} must be an object.`);
  const object = value as Record<string, unknown>;
  for (const key of Object.keys(object)) if (!allowed.includes(key)) throw new BeverApiContractError(`${name} has unsupported property '${key}'.`);
  for (const key of allowed) if (!(key in object)) throw new BeverApiContractError(`${name} is missing property '${key}'.`);
  return object;
}

function jsonRequest(method: string, values: unknown): RequestInit {
  return {
    method,
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(values)
  };
}

async function mergeHeaders(...sources: Array<HeadersInit | (() => HeadersInit | Promise<HeadersInit>) | undefined>): Promise<Headers> {
  const headers = new Headers();

  for (const source of sources) {
    const value = typeof source === "function" ? await source() : source;
    if (value === undefined) {
      continue;
    }

    new Headers(value).forEach((headerValue, headerName) => {
      headers.set(headerName, headerValue);
    });
  }

  return headers;
}

function identityLookupPath(apiPrefix: string, context: IdentityLookupContext): string {
  const base = `${apiPrefix}/${encodeURIComponent(context.entityRoute)}`;
  const scoped = context.action === "Update" ? `${base}/${encodeURIComponent(requiredId(context.id))}` : base;
  return `${scoped}/_identity-lookup/${encodeURIComponent(context.field)}`;
}

function requiredId(id: string | undefined): string {
  if (id === undefined || id.length === 0) throw new BeverApiContractError("Update identity lookup requires a containing record id.");
  return id;
}

function stateChanging(method: string | undefined): boolean {
  return method !== undefined && !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

async function antiforgeryHeader(source: BeverClientOptions["antiforgeryToken"]): Promise<HeadersInit | undefined> {
  const token = typeof source === "function" ? await source() : source ?? readCookie("XSRF-TOKEN");
  return token === undefined || token.length === 0 ? undefined : { "x-csrf-token": token, "requestverificationtoken": token };
}

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const prefix = `${name}=`;
  return document.cookie.split("; ").find(part => part.startsWith(prefix))?.slice(prefix.length);
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
