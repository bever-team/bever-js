import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  BeverApiContractError,
  humanize,
  pluralizeLabel,
  BeverHttpError,
  BeverModelValidationError,
  BeverModelVersionError,
  createBeverApp,
  createBeverClient,
  entityRouteName,
  parseBeverModel,
  toRequestFieldName
} from "../dist/index.js";

function field(name, kind = "Primitive", typeName = "Text", targets = []) {
  return {
    name,
    type: {
      kind,
      name: typeName,
      nullable: false,
      arguments: [],
      options: [],
      targets,
      onDelete: kind === "Relationship" ? "Restrict" : null,
      targetKind: kind === "Relationship" ? "Application" : null,
      picker: null
    },
    defaultValue: null,
    sourceSpan: null
  };
}

function action(verb, entity = "Product", name = null) {
  return { verb, entity, name, sourceSpan: null, authorizations: [], orderBy: null, searchBy: null };
}

function presentation(overrides = {}) {
  return {
    label: null,
    pluralLabel: null,
    recordLabel: null,
    fields: [],
    listing: null,
    details: null,
    creating: null,
    editing: null,
    actionOverrides: [],
    sourceSpan: null,
    ...overrides
  };
}

function override(name, values = {}) {
  return {
    action: { name },
    label: null,
    emphasis: null,
    confirm: null,
    placements: null,
    order: null,
    hidden: null,
    sourceSpan: null,
    ...values
  };
}

const model = {
  beverLanguageVersion: "0.6",
  semanticModelVersion: "0.10",
  identity: { enabled: false, capabilities: [], summary: null, systemTargets: [] },
  roles: [],
  entities: [
    {
      name: "Product",
      kind: "Application",
      sourceSpan: null,
      fields: [
        field("Sku", "Primitive", "Integer"),
        field("Name"),
        field("BuyPrice", "Primitive", "Decimal")
      ],
      rules: [],
      presentation: null
    }
  ],
  actions: [action("Read")],
  diagnostics: []
};

function identityEnabled(register = true) {
  return {
    enabled: true,
    capabilities: register ? ["Login", "Logout", "Session", "Register"] : ["Login", "Logout", "Session"],
    summary: { labelSource: "Email" },
    systemTargets: [{ name: "Identity", kind: "SystemIdentity", lookup: { summaryShape: "IdLabel", contextBound: true, generalReadAction: false } }]
  };
}

test("route and app helpers retain semantic access", () => {
  assert.equal(entityRouteName("Product"), "products");
  assert.equal(entityRouteName("Company"), "companies");
  assert.equal(entityRouteName("HTTPServer"), "http-servers");
  assert.equal(toRequestFieldName("BuyPrice"), "buyPrice");

  const app = createBeverApp(model);
  const product = app.requireEntity("product");
  assert.equal(product.requireField("buyprice").name, "BuyPrice");
  assert.equal(product.getRequestFieldName("BuyPrice"), "buyPrice");
  assert.deepEqual(app.getActions("Product"), model.actions);
  assert.deepEqual(product.presentation.listing.map(item => item.field.name), ["Sku", "Name", "BuyPrice"]);
  assert.equal(product.presentation.recordLabel.kind, "Field");
  assert.equal(product.presentation.recordLabel.field.name, "Name");
});

test("validated ingestion accepts exactly semantic model 0.10 and rejects duplicate JSON keys", () => {
  assert.equal(parseBeverModel(JSON.stringify(model)).semanticModelVersion, "0.10");
  for (const actual of ["0.2", undefined]) {
    const candidate = structuredClone(model);
    if (actual === undefined) delete candidate.semanticModelVersion;
    else candidate.semanticModelVersion = actual;
    assert.throws(() => createBeverApp(candidate), error =>
      error instanceof BeverModelVersionError
      && error.expectedVersion === "0.10"
      && error.actualVersion === actual);
  }
  assert.throws(
    () => parseBeverModel('{"semanticModelVersion":"0.10","semanticModelVersion":"0.10"}'),
    error => error instanceof BeverModelValidationError && /duplicate JSON property/.test(error.message)
  );
});

test("consumes the shared .NET semantic-model 0.10 conformance fixtures", () => {
  const fixtureUrl = name => new URL(`./fixtures/${name}`, import.meta.url);
  for (const fixture of ["bever-model-0.10-empty.json", "bever-model-0.10-presentation-absent.json"]) {
    assert.equal(parseBeverModel(readFileSync(fixtureUrl(fixture), "utf8")).semanticModelVersion, "0.10");
  }
  const populated = parseBeverModel(readFileSync(fixtureUrl("bever-model-0.10-identity-populated.json"), "utf8"));
  assert.equal(populated.identity.enabled, true);
  const capability = createBeverApp(populated).requireEntity("Task").presentation.creating.inputs[0].capability;
  assert.equal(capability.kind, "SystemIdentity");
  assert.equal(capability.searchable, true);
  assert.equal("targetEntity" in capability, false);
  assert.equal(populated.entities[0].rules[0].message, "Name or assign the task");
  assert.equal(populated.entities[0].rules[0].condition.kind, "Or");
  assert.equal(populated.roles[0].name, "Manager");
  assert.deepEqual(populated.actions[0].authorizations[1], { kind: "Role", path: null, role: "Manager" });
});

test("rule conditions are strict and reference fields of their entity", () => {
  const fieldRef = name => ({ kind: "Field", operator: null, operands: [], path: { segments: [name] }, literal: null });
  const literal = { kind: "Literal", operator: null, operands: [], path: null, literal: { kind: "Integer", value: 0 } };
  const withRule = condition => {
    const candidate = structuredClone(model);
    candidate.entities[0].rules = [{ condition, message: "Must be positive", sourceSpan: null }];
    return JSON.stringify(candidate);
  };
  const compare = (left, operator = ">") => ({ kind: "Compare", operator, operands: [left, literal], path: null, literal: null });

  assert.equal(parseBeverModel(withRule(compare(fieldRef("BuyPrice")))).entities[0].rules.length, 1);
  assert.throws(() => parseBeverModel(withRule(compare(fieldRef("Price")))), /unknown field 'Price'/);
  assert.throws(() => parseBeverModel(withRule(compare(fieldRef("BuyPrice"), "~"))), /unsupported rule condition 'Compare'/);
  assert.throws(() => parseBeverModel(withRule(compare(literal))), /unsupported rule condition 'Compare'/);
  assert.throws(() => parseBeverModel(withRule({ ...compare(fieldRef("BuyPrice")), extra: 1 })), /unsupported property/);
});

test("sparse action resolution is deterministic and does not mutate semantic actions", () => {
  const candidate = structuredClone(model);
  candidate.actions = [action("Delete"), action("Update"), action("Create"), action("Read")];
  candidate.entities[0].presentation = presentation({
    label: "Stock item",
    listing: { fields: [{ segments: ["Name"] }], sourceSpan: null },
    editing: { mode: "Inline", fields: null, inputs: [], sourceSpan: null },
    actionOverrides: [
      override("Delete", { hidden: true, order: -20 }),
      override("Update", { label: "Change", placements: ["DetailsToolbar"], order: -10 })
    ]
  });
  const originalActions = JSON.stringify(candidate.actions);
  const resolved = createBeverApp(candidate).requireEntity("Product").presentation;

  assert.equal(resolved.label, "Stock item");
  assert.deepEqual(resolved.listing.map(item => item.field.name), ["Name"]);
  assert.deepEqual(resolved.creating.fields.map(item => item.field.name), ["Sku", "Name", "BuyPrice"]);
  assert.deepEqual(resolved.actions.map(item => item.action.verb), ["Delete", "Update", "Create", "Read"]);
  assert.deepEqual(resolved.getActionsForPlacement("ListingRow").map(item => item.action.verb), ["Read"]);
  assert.deepEqual(resolved.getActionsForPlacement("DetailsToolbar").map(item => item.action.verb), ["Update"]);
  assert.equal(resolved.actions.find(item => item.action.verb === "Delete").confirm, "Delete this record?");
  assert.equal(JSON.stringify(candidate.actions), originalActions);
  assert.equal(candidate.entities[0].presentation.actionOverrides[1].emphasis, null);
});

test("empty Actions, bare overrides, and override permutations preserve deterministic defaults", () => {
  const withOverrides = overrides => {
    const candidate = structuredClone(model);
    candidate.actions = [action("Create"), action("Read"), action("Update"), action("Delete")];
    candidate.entities[0].presentation = presentation({ actionOverrides: overrides });
    return createBeverApp(candidate).requireEntity("Product").presentation;
  };

  const emptyActions = withOverrides([]);
  const bareUpdate = withOverrides([override("Update")]);
  assert.deepEqual(bareUpdate.actions, emptyActions.actions);

  const updateThenDelete = withOverrides([
    override("Update", { label: "Change", order: -10 }),
    override("Delete", { hidden: true, order: 10 })
  ]);
  const deleteThenUpdate = withOverrides([
    override("Delete", { hidden: true, order: 10 }),
    override("Update", { label: "Change", order: -10 })
  ]);
  assert.deepEqual(deleteThenUpdate.actions, updateThenDelete.actions);
  for (const placement of ["Navigation", "ListingToolbar", "ListingRow", "DetailsToolbar"]) {
    assert.deepEqual(
      deleteThenUpdate.getActionsForPlacement(placement),
      updateThenDelete.getActionsForPlacement(placement)
    );
  }
});

test("reference picker resolves default combobox and explicit styles from Read-backed lookup", () => {
  const candidate = structuredClone(model);
  candidate.entities.push({ name: "User", kind: "Application", fields: [field("DisplayName")], rules: [], presentation: null, sourceSpan: null });
  candidate.entities[0].fields.push(field("Owner", "Relationship", null, ["User"]));
  candidate.entities[0].presentation = presentation({
    editing: {
      mode: "Page",
      fields: null,
      inputs: [{ field: { segments: ["Owner"] }, widget: "ReferencePicker", display: "Modal", sourceSpan: null }],
      sourceSpan: null
    }
  });
  candidate.actions = [action("Create"), action("Update"), action("Read", "User")];
  const product = createBeverApp(candidate).requireEntity("Product").presentation;
  const explicit = product.editing.inputs[0];
  const automatic = product.creating.inputs[0];
  assert.equal(explicit.display, "Modal");
  assert.equal(explicit.capability.supported, true);
  assert.equal(explicit.capability.targetEntity.name, "User");
  assert.equal(explicit.capability.targetRouteName, "users");
  assert.equal(explicit.capability.searchable, true);
  assert.deepEqual(explicit.capability.searchFields.map(field => field.name), ["DisplayName"]);
  assert.equal(automatic.display, "Combobox");
});

test("reference picker reports explicit display styles and browse-only lookup capability", () => {
  const candidate = structuredClone(model);
  candidate.entities.push({
    name: "Status",
    kind: "Application",
    fields: [field("Rank", "Primitive", "Integer"), field("Code", "Primitive", "Email")],
    rules: [],
    presentation: presentation({ recordLabel: { segments: ["Rank"] } }),
    sourceSpan: null
  });
  candidate.entities[0].fields.push(
    field("PrimaryStatus", "Relationship", null, ["Status"]),
    field("SecondaryStatus", "Relationship", null, ["Status"]),
    field("TertiaryStatus", "Relationship", null, ["Status"])
  );
  candidate.entities[0].presentation = presentation({
    editing: {
      mode: "Page",
      fields: null,
      inputs: [
        { field: { segments: ["PrimaryStatus"] }, widget: "ReferencePicker", display: "Dropdown", sourceSpan: null },
        { field: { segments: ["SecondaryStatus"] }, widget: "ReferencePicker", display: "Combobox", sourceSpan: null },
        { field: { segments: ["TertiaryStatus"] }, widget: "ReferencePicker", display: "Modal", sourceSpan: null }
      ],
      sourceSpan: null
    }
  });
  candidate.actions = [action("Update"), action("Read", "Status")];

  const inputs = createBeverApp(candidate).requireEntity("Product").presentation.editing.inputs;
  assert.deepEqual(inputs.map(input => input.display), ["Dropdown", "Combobox", "Modal"]);
  for (const input of inputs) {
    assert.equal(input.capability.supported, true);
    assert.equal(input.capability.searchable, false);
    assert.deepEqual(input.capability.searchFields, []);
    assert.equal(input.capability.recordLabel.kind, "Field");
    assert.equal(input.capability.recordLabel.field.name, "Rank");
  }

  candidate.actions = [{ ...action("Read", "Status"), searchBy: [{ segments: ["Code"] }] }, action("Update")];
  const searchable = createBeverApp(candidate).requireEntity("Product").presentation.editing.inputs[0].capability;
  assert.equal(searchable.supported, true);
  assert.equal(searchable.searchable, true);
  assert.deepEqual(searchable.searchFields.map(field => field.name), ["Code"]);
  assert.equal(searchable.recordLabel.kind, "Field");
  assert.equal(searchable.recordLabel.field.name, "Rank");
});

test("searchBy is required, nullable only for Read, local, searchable, and unique", () => {
  const withReadSearch = structuredClone(model);
  withReadSearch.actions = [{ ...action("Read"), searchBy: [{ segments: ["Name"] }] }];
  assert.equal(createBeverApp(withReadSearch).actions[0].searchBy[0].segments[0], "Name");
  for (const mutate of [
    candidate => { delete candidate.actions[0].searchBy },
    candidate => { candidate.actions[0].unknown = true },
    candidate => { candidate.actions = [{ ...action("Update"), searchBy: [{ segments: ["Name"] }] }] },
    candidate => { candidate.actions = [{ ...action("Read"), searchBy: [] }] },
    candidate => { candidate.actions = [{ ...action("Read"), searchBy: [{ segments: ["BuyPrice"] }] }] },
    candidate => { candidate.actions = [{ ...action("Read"), searchBy: [{ segments: ["Name"] }, { segments: ["Name"] }] }] },
    candidate => { candidate.actions = [{ ...action("Read"), searchBy: [{ segments: ["Owner", "Name"] }] }] },
    candidate => { candidate.actions = [{ ...action("Read"), searchBy: [{ segments: ["Name"], absolute: true }] }] },
    candidate => { candidate.actions = [{ ...action("Read"), searchBy: [{ segments: [] }] }] },
    candidate => { candidate.actions = [{ ...action("Read"), searchBy: "Name" }] },
  ]) {
    const candidate = structuredClone(model); mutate(candidate);
    assert.throws(() => createBeverApp(candidate), BeverModelValidationError);
  }
  assert.throws(
    () => parseBeverModel(JSON.stringify({
      ...model,
      actions: [{ verb: "Read", entity: "Product", sourceSpan: null, authorizations: [], orderBy: null, searchBy: null, searchByExtra: null }]
    })),
    BeverModelValidationError
  );
  assert.throws(
      () => parseBeverModel('{"beverLanguageVersion":"0.3","semanticModelVersion":"0.10","identity":{"enabled":false,"capabilities":[],"summary":null,"systemTargets":[]},"roles":[],"entities":[],"actions":[{"verb":"Read","entity":"Product","sourceSpan":null,"authorizations":[],"orderBy":null,"searchBy":null,"searchBy":[]}]}'),
    error => error instanceof BeverModelValidationError && /duplicate JSON property/.test(error.message)
  );
});

test("HTTP model loading validates raw text and mutation methods remain available without Read", async () => {
  const mutationOnly = structuredClone(model);
  mutationOnly.actions = [action("Update"), action("Delete")];
  const semanticActions = createBeverApp(mutationOnly).requireEntity("Product").presentation.actions;
  assert.deepEqual(semanticActions.map(item => item.action.verb), ["Update", "Delete"]);
  const calls = [];
  const identityModel = structuredClone(model);
  identityModel.identity = identityEnabled();
  const client = createBeverClient({
    baseUrl: "https://example.test/",
    model: identityModel,
    fetch: async (input, init) => {
      calls.push({ input: input.toString(), init });
      if (input.toString().endsWith("/_bever/model")) return jsonResponse(mutationOnly);
      if (init?.method === "PATCH") return jsonResponse({ id: "1", name: "Changed" });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return jsonResponse({ message: "not found" }, { status: 404, statusText: "Not Found" });
    }
  });
  const anonymousClient = createBeverClient({ fetch: async () => jsonResponse({}) });
  assert.equal(anonymousClient.login, undefined);
  assert.equal(anonymousClient.logout, undefined);
  assert.equal(anonymousClient.getSession, undefined);
  assert.equal(anonymousClient.register, undefined);

  assert.equal((await client.getModel()).semanticModelVersion, "0.10");
  assert.deepEqual(await client.patch("products", "1", { name: "Changed" }), { id: "1", name: "Changed" });
  await client.delete("products", "1");
  assert.equal(calls[1].init.method, "PATCH");
  assert.equal(calls[2].init.method, "DELETE");
  await assert.rejects(() => client.get("products", "missing"), BeverHttpError);
});

test("HTTP model loading rejects duplicate properties before JSON decoding", async () => {
  const client = createBeverClient({
    fetch: async () => new Response('{"semanticModelVersion":"0.10","semanticModelVersion":"0.10"}')
  });
  await assert.rejects(() => client.getModel(), BeverModelValidationError);
});

test("identity model validation rejects impossible identity metadata", () => {
  for (const mutate of [
    candidate => { candidate.identity.capabilities = ["Login", "Session", "Logout"] },
    candidate => { candidate.identity.summary = null },
    candidate => { candidate.identity.systemTargets = [] },
    candidate => { candidate.entities[0].name = "Identity" },
    candidate => { candidate.actions = [action("Read", "Identity")] },
    candidate => { candidate.entities[0].fields.push(field("Owner", "Relationship", null, ["Identity"])); candidate.identity.enabled = false; candidate.identity.capabilities = []; candidate.identity.summary = null; candidate.identity.systemTargets = [] },
    candidate => { candidate.entities[0].fields.push(field("Owner", "Relationship", null, ["Product"])); candidate.entities[0].fields.at(-1).type.targetKind = "SystemIdentity" },
    candidate => { candidate.actions[0].authorizations = [{ kind: "Role", path: null, role: "Agent" }] },
    candidate => { candidate.roles = [{ name: "Agent", sourceSpan: null }]; candidate.actions[0].authorizations = [{ kind: "Role", path: null, role: "agent" }] },
    candidate => { candidate.roles = [{ name: "Agent", sourceSpan: null }]; candidate.actions[0].authorizations = [{ kind: "Authenticated", path: null, role: "Agent" }] },
    candidate => { candidate.roles = [{ name: "Agent", sourceSpan: null }]; candidate.actions[0].authorizations = [{ kind: "Authenticated", path: null }] },
    candidate => { candidate.roles = [{ name: "Agent", sourceSpan: null }, { name: "AGENT", sourceSpan: null }] },
    candidate => { candidate.roles = [{ name: "Administrator", sourceSpan: null }] },
    candidate => { candidate.roles = [{ name: "Agent" }] },
    candidate => { delete candidate.roles },
    candidate => { candidate.actions[0].authorizations = [{ kind: "Path", path: { segments: ["Owner", "Email"] }, role: null }] },
  ]) {
    const candidate = structuredClone(model);
    if (candidate.identity.enabled === false) candidate.identity = identityEnabled();
    mutate(candidate);
    assert.throws(() => createBeverApp(candidate), BeverModelValidationError);
  }
});

test("identity helpers use credentialed CSRF requests and context-bound picker routes", async () => {
  const calls = [];
  const client = createBeverClient({
    baseUrl: "https://example.test/",
    antiforgeryToken: "csrf",
    model: { ...model, identity: identityEnabled() },
    fetch: async (input, init) => {
      calls.push({ input: input.toString(), init });
      if (input.toString().includes("session") || input.toString().includes("login") || input.toString().includes("register")) return jsonResponse({ authenticated: true, identity: { id: "idn_1", label: "ada@example.test" }, administrator: false, roles: [] });
      if (input.toString().includes("logout")) return new Response(null, { status: 204 });
      if (input.toString().includes("hydrate")) return jsonResponse({ items: [{ id: "idn_1", label: "Ada" }] });
      return jsonResponse({ items: [{ id: "idn_1", label: "Ada" }], nextCursor: null });
    }
  });
  assert.equal((await client.login({ email: "ada@example.test", password: "pw" })).identity.label, "ada@example.test");
  await client.logout();
  await client.register({ email: "ada@example.test", password: "pw" });
  await client.lookupIdentities({ entityRoute: "tasks", action: "Create", field: "assignee" }, { search: "a", limit: 20 });
  await client.hydrateIdentities({ entityRoute: "tasks", action: "Update", id: "t1", field: "assignee" }, { ids: ["idn_1"] });
  assert.equal(calls[0].init.credentials, "include");
  assert.equal(new Headers(calls[0].init.headers).get("x-csrf-token"), "csrf");
  assert.equal(calls[3].input, "https://example.test/api/v1/tasks/_identity-lookup/assignee?action=Create&search=a&limit=20");
  assert.equal(calls[4].input, "https://example.test/api/v1/tasks/t1/_identity-lookup/assignee/hydrate?action=Update");
  assert.equal(calls.some(call => call.input.includes("_antiforgery/token")), false);
});

test("roles: role rules validate, sessions carry roles, and Administrators list accounts and set their roles", async () => {
  const withRoles = { ...structuredClone(model), identity: identityEnabled(), roles: [{ name: "Agent", sourceSpan: null }, { name: "Manager", sourceSpan: null }] };
  withRoles.actions[0].authorizations = [{ kind: "Role", path: null, role: "Agent" }];
  assert.equal(parseBeverModel(JSON.stringify(withRoles)).actions[0].authorizations[0].role, "Agent");
  assert.equal(createBeverClient({ model: { ...model, identity: identityEnabled() }, fetch: async () => jsonResponse({}) }).listAccounts, undefined);

  const calls = [];
  const account = { id: "idn_2", label: "bob@example.test", administrator: false, roles: ["Agent"] };
  let session = { authenticated: true, identity: { id: "idn_1", label: "ada@example.test" }, administrator: true, roles: ["Manager"] };
  const client = createBeverClient({
    model: withRoles,
    antiforgeryToken: "csrf",
    fetch: async (input, init) => {
      calls.push({ input: input.toString(), init });
      if (input.toString().includes("session")) return jsonResponse(session);
      if (init?.method === "PATCH") return jsonResponse({ ...account, roles: JSON.parse(init.body).roles });
      return jsonResponse({ items: [account], nextCursor: "next" });
    }
  });

  assert.deepEqual((await client.getSession()).roles, ["Manager"]);
  assert.deepEqual(await client.listAccounts({ search: "bob", limit: 10 }), { items: [account], nextCursor: "next" });
  assert.equal(calls[1].input, "/api/v1/_identity/accounts?search=bob&limit=10");
  assert.deepEqual((await client.setAccountRoles("idn_2", ["Agent", "Manager"])).roles, ["Agent", "Manager"]);
  assert.equal(calls[2].input, "/api/v1/_identity/accounts/idn_2");
  assert.equal(new Headers(calls[2].init.headers).get("x-csrf-token"), "csrf");
  assert.deepEqual(JSON.parse(calls[2].init.body), { roles: ["Agent", "Manager"] });

  assert.throws(() => client.setAccountRoles("idn_2", ["Auditor"]), BeverApiContractError);
  assert.throws(() => client.setAccountRoles("idn_2", ["Agent", "Agent"]), BeverApiContractError);
  assert.throws(() => client.listAccounts({ picker: "Mine" }), BeverApiContractError);
  session = { authenticated: true, identity: null, administrator: false };
  await assert.rejects(() => client.getSession(), BeverApiContractError);
});

test("HTTP reference lookup APIs validate bounds, closed responses, and dropdown requests exactly 50", async () => {
  const calls = [];
  const client = createBeverClient({
    baseUrl: "https://example.test/",
    fetch: async (input, init) => {
      calls.push({ input: input.toString(), init });
      if (input.toString().includes("hydrate")) return jsonResponse({ items: [{ id: "u1", label: "Ada" }] });
      return jsonResponse({ items: [{ id: "u1", label: "Ada" }], nextCursor: "more" });
    }
  });
  assert.equal((await client.loadDropdownReferences("users")).nextCursor, "more");
  assert.equal(new URL(calls[0].input).searchParams.get("limit"), "50");
  assert.deepEqual(await client.hydrateReferences("users", { ids: ["u1", "u1"] }), { items: [{ id: "u1", label: "Ada" }] });
  assert.throws(() => client.lookupReferences("users", { limit: 51 }), BeverApiContractError);
  assert.throws(() => client.lookupReferences("users", { unknown: true }), BeverApiContractError);
  assert.throws(() => client.hydrateReferences("users", { ids: [] }), BeverApiContractError);
  assert.throws(() => client.hydrateReferences("users", { ids: [1] }), BeverApiContractError);

  const bad = createBeverClient({ fetch: async () => jsonResponse({ items: [{ id: "u1", label: "Ada", extra: true }], nextCursor: null }) });
  await assert.rejects(() => bad.lookupReferences("users"), /unsupported property/);
});

function pickerModel() {
  const candidate = structuredClone(model);
  candidate.entities.push({ name: "Project", kind: "Application", fields: [field("Code", "Primitive", "Int"), field("Title")], rules: [], presentation: null, sourceSpan: null });
  candidate.entities.push({ name: "Customer", kind: "Application", fields: [field("Number", "Primitive", "Int"), field("Paid", "Primitive", "Boolean")], rules: [], presentation: null, sourceSpan: null });
  const managed = field("Project", "Relationship", null, ["Project"]);
  managed.type.picker = "Managed";
  candidate.entities[0].fields.push(managed, field("Customer", "Relationship", null, ["Customer"]));
  const pick = action("Pick", "Project", "Managed");
  pick.searchBy = [{ segments: ["Title"] }];
  candidate.actions = [action("Create"), action("Read", "Project"), pick, action("Pick", "Customer")];
  return candidate;
}

test("pickers resolve per field: named picker, then default Pick, then Read, never as presentation actions", () => {
  const app = createBeverApp(pickerModel());
  const [project, customer] = app.requireEntity("Product").presentation.creating.inputs;
  assert.equal(project.capability.picker, "Managed");
  assert.deepEqual(project.capability.searchFields.map(item => item.name), ["Title"]);
  assert.equal(customer.capability.picker, null);
  assert.equal(customer.capability.recordLabel.field.name, "Number");
  assert.deepEqual(app.requireEntity("Customer").presentation.actions, []);
  assert.equal(app.requireEntity("Project").presentation.actions.map(item => item.action.verb).join(), "Read");
  const unlabeled = structuredClone(model);
  unlabeled.entities[0].fields = [field("Paid", "Primitive", "Boolean")];
  assert.equal(createBeverApp(unlabeled).requireEntity("Product").presentation.recordLabel.kind, "None");
});

test("picker validation rejects unknown pickers, unpickable form fields, unlabeled targets, and Pick overrides", () => {
  const invalid = [
    [candidate => { candidate.actions[1].name = "Managed"; }, "$.actions[1].name"],
    [candidate => { delete candidate.entities[0].fields[0].type.picker; }, "$.entities[0].fields[0].type.picker"],
    [candidate => { candidate.entities[0].fields[3].type.picker = "Missing"; }, "$.entities[0].fields[3].type.picker"],
    [candidate => { candidate.actions = candidate.actions.filter(item => item.entity !== "Customer"); }, "$.entities[0].fields[4]"],
    [candidate => { candidate.entities[2].fields = [field("Paid", "Primitive", "Boolean")]; }, "$.entities[0].fields[4]"],
    [candidate => { candidate.actions[3].orderBy = { path: null, direction: "Asc" }; }, "$.actions[3].orderBy"],
    [candidate => { candidate.entities[1].presentation = presentation({ actionOverrides: [override("Pick")] }); }, "$.entities[1].presentation.actionOverrides[0].action"]
  ];
  for (const [mutate, path] of invalid) {
    const candidate = pickerModel();
    mutate(candidate);
    assert.throws(() => createBeverApp(candidate), error => error instanceof BeverModelValidationError && error.path === path, path);
  }
});

test("lookup sends the field's picker", async () => {
  const calls = [];
  const client = createBeverClient({ fetch: async input => { calls.push(new URL(input.toString(), "https://example.test")); return jsonResponse({ items: [], nextCursor: null }); } });
  await client.lookupReferences("projects", { picker: "Managed", search: "ap" });
  assert.equal(calls[0].pathname, "/api/v1/projects/_lookup");
  assert.equal(calls[0].searchParams.get("picker"), "Managed");
  assert.throws(() => client.lookupReferences("projects", { picker: "not a name" }), BeverApiContractError);
});

function jsonResponse(body, init) {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json"
    },
    ...init
  });
}

test("default labels are readable: humanized names and plural entity labels", () => {
  const cases = [["DueDate", "Due date", "Due dates"], ["SalesOrder", "Sales order", "Sales orders"], ["Category", "Category", "Categories"], ["Box", "Box", "Boxes"], ["URL", "URL", "URLs"], ["SKUCode", "SKU code", "SKU codes"]];
  for (const [name, label, plural] of cases) {
    assert.equal(humanize(name), label);
    assert.equal(pluralizeLabel(label), plural);
  }
});
