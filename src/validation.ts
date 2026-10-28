import type {
  ActionModel,
  ActionPresentationOverrideModel,
  AuthorizationModel,
  BeverActionVerb,
  BeverModel,
  EntityModel,
  EntityPresentationModel,
  FieldModel,
  InputExperiencePresentationModel,
  IdentityModel,
  ReferencePathModel,
  RoleModel
} from "./model.js";

export const SUPPORTED_SEMANTIC_MODEL_VERSION = "0.10";

const crudVerbs = ["Create", "Read", "Update", "Delete"] as const;
const presentationProperties = [
  "label", "pluralLabel", "recordLabel", "fields", "listing", "details", "creating", "editing", "actionOverrides", "sourceSpan"
] as const;
const surfaceProperties = ["fields", "sourceSpan"] as const;
const experienceProperties = ["mode", "fields", "inputs", "sourceSpan"] as const;
const presentationFieldProperties = ["field", "label", "sourceSpan"] as const;
const inputProperties = ["field", "widget", "display", "sourceSpan"] as const;
const overrideProperties = ["action", "label", "emphasis", "confirm", "placements", "order", "hidden", "sourceSpan"] as const;
const actionReferenceProperties = ["name"] as const;
const actionProperties = ["verb", "entity", "name", "sourceSpan", "authorizations", "orderBy", "searchBy"] as const;
const referenceProperties = ["segments"] as const;
const identityProperties = ["enabled", "capabilities", "summary", "systemTargets"] as const;
const identitySummaryProperties = ["labelSource"] as const;
const identityTargetProperties = ["name", "kind", "lookup"] as const;
const identityLookupProperties = ["summaryShape", "contextBound", "generalReadAction"] as const;
const authorizationProperties = ["kind", "path", "role"] as const;
const roleProperties = ["name", "sourceSpan"] as const;
const reservedRoleNames = ["Anyone", "Authenticated", "Administrator", "Identity"];
const ruleProperties = ["condition", "message", "sourceSpan"] as const;
const expressionProperties = ["kind", "operator", "operands", "path", "literal"] as const;
const comparisonOperators = ["=", "!=", "<", "<=", ">", ">="];

export class BeverModelVersionError extends Error {
  readonly expectedVersion = SUPPORTED_SEMANTIC_MODEL_VERSION;
  readonly actualVersion: unknown;

  constructor(actualVersion: unknown) {
    super(`Unsupported Bever semantic model version '${String(actualVersion)}'; expected '${SUPPORTED_SEMANTIC_MODEL_VERSION}'.`);
    this.name = "BeverModelVersionError";
    this.actualVersion = actualVersion;
  }
}

export class BeverModelValidationError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`Invalid Bever semantic model at ${path}: ${message}.`);
    this.name = "BeverModelValidationError";
    this.path = path;
  }
}

export function parseBeverModel(json: string): BeverModel {
  rejectDuplicateJsonProperties(json);
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new BeverModelValidationError("$", `invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateBeverModel(value);
}

export function validateBeverModel(value: unknown): BeverModel {
  const model = object(value, "$", "model must be an object");
  if (model.semanticModelVersion !== SUPPORTED_SEMANTIC_MODEL_VERSION) {
    throw new BeverModelVersionError(model.semanticModelVersion);
  }

  string(model.beverLanguageVersion, "$.beverLanguageVersion");
  const identity = validateIdentity(model.identity, "$.identity");
  const roles = validateRoles(model.roles, identity, "$.roles");
  const entities = array(model.entities, "$.entities");
  const actions = array(model.actions, "$.actions");

  const typedActions = actions.map((action, index) => validateAction(action, `$.actions[${index}]`));
  const actionKeys = new Set<string>();
  for (let index = 0; index < typedActions.length; index++) {
    const action = typedActions[index];
    addUnique(actionKeys, `${action.entity.toLowerCase()}:${action.verb.toLowerCase()}:${(action.name ?? "").toLowerCase()}`, `$.actions[${index}]`, "action identity");
  }

  const entityNames = new Set<string>();
  const typedEntities = entities.map((entity, index) => {
    const typed = validateEntity(entity, identity, `$.entities[${index}]`);
    addUnique(entityNames, typed.name.toLowerCase(), `$.entities[${index}].name`, "entity name");
    return typed;
  });
  const entityMap = new Map(typedEntities.map(entity => [entity.name.toLowerCase(), entity]));
  for (let index = 0; index < typedActions.length; index++) {
    if (!entityMap.has(typedActions[index].entity.toLowerCase())) {
      fail(`$.actions[${index}].entity`, `unknown entity '${typedActions[index].entity}'`);
    }
    validateActionSearchBy(typedActions[index], entityMap.get(typedActions[index].entity.toLowerCase())!, typedActions, `$.actions[${index}]`);
    validateAuthorizations(typedActions[index], entityMap.get(typedActions[index].entity.toLowerCase())!, identity, roles, `$.actions[${index}].authorizations`);
  }
  for (let index = 0; index < typedEntities.length; index++) {
    validatePresentation(typedEntities[index], typedActions, entityMap, identity, `$.entities[${index}].presentation`);
    validatePickers(typedEntities[index], typedActions, entityMap, `$.entities[${index}]`);
  }

  return value as BeverModel;
}

function validateIdentity(value: unknown, path: string): IdentityModel {
  const identity = closedObject(value, path, identityProperties);
  if (typeof identity.enabled !== "boolean") fail(`${path}.enabled`, "must be a boolean");
  const capabilities = array(identity.capabilities, `${path}.capabilities`);
  const allowed = identity.enabled ? ["Login", "Logout", "Session", "Register"] : [];
  const expectedLength = identity.enabled ? (capabilities.length === 4 ? 4 : 3) : 0;
  if (capabilities.length !== expectedLength) fail(`${path}.capabilities`, identity.enabled ? "enabled identity must expose Login, Logout, Session, and optional Register" : "disabled identity must not expose capabilities");
  capabilities.forEach((capability, index) => { if (string(capability, `${path}.capabilities[${index}]`) !== allowed[index]) fail(`${path}.capabilities[${index}]`, "unsupported identity capability order"); });
  if (identity.summary !== null) {
    const summary = closedObject(identity.summary, `${path}.summary`, identitySummaryProperties);
    if (summary.labelSource !== "Email") fail(`${path}.summary.labelSource`, "must be 'Email'");
  }
  const targets = array(identity.systemTargets, `${path}.systemTargets`);
  targets.forEach((target, index) => {
    const item = closedObject(target, `${path}.systemTargets[${index}]`, identityTargetProperties);
    if (item.name !== "Identity") fail(`${path}.systemTargets[${index}].name`, "must be 'Identity'");
    if (item.kind !== "SystemIdentity") fail(`${path}.systemTargets[${index}].kind`, "must be 'SystemIdentity'");
    const lookup = closedObject(item.lookup, `${path}.systemTargets[${index}].lookup`, identityLookupProperties);
    if (lookup.summaryShape !== "IdLabel" || lookup.contextBound !== true || lookup.generalReadAction !== false) fail(`${path}.systemTargets[${index}].lookup`, "has unsupported identity lookup metadata");
  });
  if (!identity.enabled && (identity.summary !== null || targets.length !== 0)) fail(path, "disabled identity must not expose capabilities, summary, or system targets");
  if (identity.enabled) {
    if (identity.summary === null) fail(`${path}.summary`, "enabled identity must expose Email summary");
    if (targets.length !== 1) fail(`${path}.systemTargets`, "enabled identity must expose exactly one Identity system target");
  }
  return value as IdentityModel;
}

function validateRoles(value: unknown, identity: IdentityModel, path: string): RoleModel[] {
  const names = new Set<string>();
  return array(value, path).map((item, index) => {
    const role = closedObject(item, `${path}[${index}]`, roleProperties) as unknown as RoleModel;
    if (typeof role.name !== "string" || !/^[A-Za-z][A-Za-z0-9]*$/.test(role.name) || reservedRoleNames.includes(role.name)) fail(`${path}[${index}].name`, "must be an identifier other than Anyone, Authenticated, Administrator, or Identity");
    addUnique(names, role.name.toLowerCase(), `${path}[${index}].name`, "role name");
    if (!identity.enabled) fail(`${path}[${index}]`, "roles require enabled identity");
    return role;
  });
}

function validateAction(value: unknown, path: string): ActionModel {
  const action = closedObject(value, path, actionProperties);
  const verb = string(action.verb, `${path}.verb`);
  if (!isCrudVerb(verb) && verb !== "Pick") fail(`${path}.verb`, `unsupported action '${verb}'`);
  if (action.name !== null && (verb !== "Pick" || typeof action.name !== "string" || !/^[A-Za-z][A-Za-z0-9]*$/.test(action.name))) fail(`${path}.name`, "only Pick actions may carry a picker name, and it must be an identifier");
  if (verb !== "Read" && action.orderBy !== null) fail(`${path}.orderBy`, "only Read actions may declare orderBy");
  if (string(action.entity, `${path}.entity`) === "Identity") fail(`${path}.entity`, "Identity is not an application action target");
  array(action.authorizations, `${path}.authorizations`);
  if (action.orderBy !== null) {
    const orderBy = object(action.orderBy, `${path}.orderBy`);
    if (orderBy.path !== undefined && orderBy.path !== null) validateReferenceShape(orderBy.path, `${path}.orderBy.path`);
  }
  if (action.searchBy !== null) array(action.searchBy, `${path}.searchBy`).forEach((item, index) => validateReferenceShape(item, `${path}.searchBy[${index}]`));
  return value as ActionModel;
}

function validateActionSearchBy(action: ActionModel, entity: EntityModel, actions: ActionModel[], path: string): void {
  if (action.searchBy === null) return;
  if (action.verb !== "Read" && action.verb !== "Pick") fail(`${path}.searchBy`, "must be null for actions other than Read and Pick");
  if (action.verb === "Read" && actions.some(candidate => candidate.verb === "Pick" && candidate.name === null && candidate.entity === action.entity)) fail(`${path}.searchBy`, "is unused on Read when a default Pick is declared");
  if (action.searchBy.length === 0) fail(`${path}.searchBy`, "must not be empty");
  const fields = new Map(entity.fields.map(field => [field.name, field]));
  const seen = new Set<string>();
  action.searchBy.forEach((reference, index) => {
    const field = resolveLocalReference(reference, fields, `${path}.searchBy[${index}]`);
    if (!isSearchableField(field)) fail(`${path}.searchBy[${index}]`, "field is not searchable in the first slice");
    addUnique(seen, field.name.toLowerCase(), `${path}.searchBy[${index}]`, "search field");
  });
}

function validateEntity(value: unknown, identity: IdentityModel, path: string): EntityModel {
  const entity = object(value, path);
  if (string(entity.name, `${path}.name`) === "Identity") fail(`${path}.name`, "Identity is reserved for the built-in identity target");
  if (entity.kind !== "Application") fail(`${path}.kind`, "must be 'Application'");
  const fields = array(entity.fields, `${path}.fields`);
  const names = new Set<string>();
  fields.forEach((field, index) => {
    const typed = validateField(field, identity, `${path}.fields[${index}]`);
    addUnique(names, typed.name.toLowerCase(), `${path}.fields[${index}].name`, "field name");
  });
  const fieldMap = new Map((fields as FieldModel[]).map(field => [field.name, field]));
  array(entity.rules, `${path}.rules`).forEach((rule, index) => {
    const typed = closedObject(rule, `${path}.rules[${index}]`, ruleProperties);
    string(typed.message, `${path}.rules[${index}].message`);
    validateCondition(typed.condition, fieldMap, `${path}.rules[${index}].condition`);
  });
  if (!("presentation" in entity)) fail(`${path}.presentation`, "property is required");
  if (entity.presentation !== null) validatePresentationShape(entity.presentation, `${path}.presentation`);
  return value as EntityModel;
}

// Boolean nodes over comparisons of a local field, the shape the server evaluates.
function validateCondition(value: unknown, fields: Map<string, FieldModel>, path: string): void {
  const expression = closedObject(value, path, expressionProperties);
  const operands = array(expression.operands, `${path}.operands`);
  const kinds = operands.map((operand, index) => object(operand, `${path}.operands[${index}]`).kind);
  const valid = expression.kind === "And" || expression.kind === "Or" ? operands.length >= 2
    : expression.kind === "Not" ? operands.length === 1
    : expression.kind === "Compare" ? operands.length === 2 && comparisonOperators.includes(expression.operator as string) && kinds.includes("Field")
    : expression.kind === "In" ? operands.length >= 2 && kinds[0] === "Field" && kinds.slice(1).every(kind => kind === "Literal")
    : false;
  if (!valid) fail(path, `unsupported rule condition '${String(expression.kind)}'`);
  operands.forEach((operand, index) => {
    const operandPath = `${path}.operands[${index}]`;
    if (["And", "Or", "Not"].includes(expression.kind as string)) return validateCondition(operand, fields, operandPath);
    const typed = closedObject(operand, operandPath, expressionProperties);
    if (typed.kind === "Field") resolveLocalReference(validateReferenceShape(typed.path, `${operandPath}.path`), fields, `${operandPath}.path`);
    else if (typed.kind === "Literal") object(typed.literal, `${operandPath}.literal`);
    else if (!["Null", "Today", "Now"].includes(typed.kind as string)) fail(operandPath, `unsupported rule value '${String(typed.kind)}'`);
  });
}

function validateField(value: unknown, identity: IdentityModel, path: string): FieldModel {
  const field = object(value, path);
  string(field.name, `${path}.name`);
  if (field.type !== null && field.type !== undefined) {
    const type = object(field.type, `${path}.type`);
    string(type.kind, `${path}.type.kind`);
    if (typeof type.nullable !== "boolean") fail(`${path}.type.nullable`, "must be a boolean");
    array(type.arguments, `${path}.type.arguments`);
    array(type.options, `${path}.type.options`);
    array(type.targets, `${path}.type.targets`).forEach((target, index) => string(target, `${path}.type.targets[${index}]`));
    if (type.targetKind !== null && type.targetKind !== undefined && !["Application", "SystemIdentity"].includes(type.targetKind as string)) fail(`${path}.type.targetKind`, "has unsupported target kind");
    if (!("picker" in type)) fail(`${path}.type.picker`, "property is required");
    if (type.picker !== null && (type.kind !== "Relationship" || type.targetKind !== "Application" || typeof type.picker !== "string")) fail(`${path}.type.picker`, "is valid only on application relationships");
    if (type.kind === "Relationship") validateRelationshipTarget(type, identity, path);
  }
  return value as FieldModel;
}

function validateRelationshipTarget(type: Record<string, unknown>, identity: IdentityModel, path: string): void {
  const targets = type.targets as unknown[];
  if (targets.length !== 1) return;
  const target = targets[0];
  if (type.targetKind === "SystemIdentity") {
    if (target !== "Identity") fail(`${path}.type.targetKind`, "SystemIdentity is only valid for Identity");
    if (!identity.enabled) fail(`${path}.type.targets[0]`, "Identity target requires enabled identity");
  }
  if (target === "Identity" && type.targetKind !== "SystemIdentity") fail(`${path}.type.targetKind`, "Identity target requires SystemIdentity targetKind");
}

function validateAuthorizations(action: ActionModel, entity: EntityModel, identity: IdentityModel, roles: RoleModel[], path: string): void {
  const fields = new Map(entity.fields.map(field => [field.name, field]));
  action.authorizations.forEach((item, index) => {
    const authorization = closedObject(item, `${path}[${index}]`, authorizationProperties) as unknown as AuthorizationModel;
    if (!["Anyone", "Authenticated", "Path", "Role"].includes(authorization.kind)) fail(`${path}[${index}].kind`, `unsupported authorization kind '${authorization.kind}'`);
    if (authorization.kind === "Role") {
      if (!roles.some(role => role.name === authorization.role)) fail(`${path}[${index}].role`, `Role authorization must name a declared role, not '${String(authorization.role)}'`);
    } else if (authorization.role !== null) {
      fail(`${path}[${index}].role`, "only Role authorization may name a role");
    }
    if (authorization.kind === "Path") {
      if (authorization.path === null) fail(`${path}[${index}].path`, "Path authorization requires a path");
      const field = resolveLocalReference(authorization.path!, fields, `${path}[${index}].path`);
      if (!identity.enabled || field.type?.kind !== "Relationship" || field.type.targetKind !== "SystemIdentity" || field.type.targets[0] !== "Identity") fail(`${path}[${index}].path`, "Path authorization must target built-in Identity");
    } else if (authorization.path !== null) {
      fail(`${path}[${index}].path`, "only Path authorization may carry a path");
    }
  });
}

function validatePresentationShape(value: unknown, path: string): EntityPresentationModel {
  const presentation = closedObject(value, path, presentationProperties);
  nullableText(presentation.label, `${path}.label`);
  nullableText(presentation.pluralLabel, `${path}.pluralLabel`);
  if (presentation.recordLabel !== null) validateReferenceShape(presentation.recordLabel, `${path}.recordLabel`);
  array(presentation.fields, `${path}.fields`).forEach((item, index) => {
    const field = closedObject(item, `${path}.fields[${index}]`, presentationFieldProperties);
    validateReferenceShape(field.field, `${path}.fields[${index}].field`);
    text(field.label, `${path}.fields[${index}].label`);
  });
  for (const surfaceName of ["listing", "details"] as const) {
    const surface = presentation[surfaceName];
    if (surface !== null) {
      const typed = closedObject(surface, `${path}.${surfaceName}`, surfaceProperties);
      if (typed.fields !== null) array(typed.fields, `${path}.${surfaceName}.fields`).forEach((item, index) => validateReferenceShape(item, `${path}.${surfaceName}.fields[${index}]`));
    }
  }
  for (const experienceName of ["creating", "editing"] as const) {
    const experience = presentation[experienceName];
    if (experience !== null) validateExperienceShape(experience, `${path}.${experienceName}`);
  }
  array(presentation.actionOverrides, `${path}.actionOverrides`).forEach((item, index) => validateOverrideShape(item, `${path}.actionOverrides[${index}]`));
  return value as EntityPresentationModel;
}

function validateExperienceShape(value: unknown, path: string): InputExperiencePresentationModel {
  const experience = closedObject(value, path, experienceProperties);
  string(experience.mode, `${path}.mode`);
  if (experience.fields !== null) array(experience.fields, `${path}.fields`).forEach((item, index) => validateReferenceShape(item, `${path}.fields[${index}]`));
  array(experience.inputs, `${path}.inputs`).forEach((item, index) => {
    const input = closedObject(item, `${path}.inputs[${index}]`, inputProperties);
    validateReferenceShape(input.field, `${path}.inputs[${index}].field`);
    if (input.widget !== "ReferencePicker") fail(`${path}.inputs[${index}].widget`, "must be 'ReferencePicker'");
    if (!["Dropdown", "Combobox", "Modal"].includes(input.display as string)) fail(`${path}.inputs[${index}].display`, "must be one of Dropdown, Combobox, or Modal");
  });
  return value as InputExperiencePresentationModel;
}

function validateOverrideShape(value: unknown, path: string): ActionPresentationOverrideModel {
  const override = closedObject(value, path, overrideProperties);
  const action = closedObject(override.action, `${path}.action`, actionReferenceProperties);
  string(action.name, `${path}.action.name`);
  nullableText(override.label, `${path}.label`);
  nullableText(override.confirm, `${path}.confirm`);
  if (override.emphasis !== null && !["Default", "Primary", "Destructive"].includes(override.emphasis as string)) fail(`${path}.emphasis`, "has an unsupported value");
  if (override.order !== null && (!Number.isInteger(override.order) || (override.order as number) < -2147483648 || (override.order as number) > 2147483647)) fail(`${path}.order`, "must be a signed 32-bit integer or null");
  if (override.hidden !== null && typeof override.hidden !== "boolean") fail(`${path}.hidden`, "must be a boolean or null");
  if (override.placements !== null) array(override.placements, `${path}.placements`);
  return value as ActionPresentationOverrideModel;
}

function validatePresentation(entity: EntityModel, actions: ActionModel[], entities: Map<string, EntityModel>, identity: IdentityModel, path: string): void {
  const presentation = entity.presentation;
  if (presentation === null) return;
  const fields = new Map(entity.fields.map(field => [field.name, field]));
  const actionMap = new Map(actions.filter(action => action.entity.toLowerCase() === entity.name.toLowerCase()).map(action => [action.verb.toLowerCase(), action]));
  if (presentation.recordLabel !== null) {
    const field = resolveLocalReference(presentation.recordLabel, fields, `${path}.recordLabel`);
    if (!isDisplayField(field)) fail(`${path}.recordLabel`, "field does not have an approved deterministic display type");
  }
  validateUniqueReferences(presentation.fields.map(item => item.field), fields, `${path}.fields`);
  for (const [surfaceName, surface] of [["listing", presentation.listing], ["details", presentation.details]] as const) {
    if (surface?.fields !== null && surface?.fields !== undefined) validateUniqueNonemptyReferences(surface.fields, fields, `${path}.${surfaceName}.fields`);
  }
  validateExperience(entity, presentation.creating, "creating", fields, actionMap, actions, entities, identity, path);
  validateExperience(entity, presentation.editing, "editing", fields, actionMap, actions, entities, identity, path);

  const overrides = new Set<string>();
  presentation.actionOverrides.forEach((override, index) => {
    const overridePath = `${path}.actionOverrides[${index}]`;
    const name = override.action.name.toLowerCase();
    if (name === "pick") fail(`${overridePath}.action`, "Pick has no generated control, so presentation cannot override it");
    const action = actionMap.get(name);
    if (action === undefined) fail(`${overridePath}.action`, `action '${override.action.name}' is not declared for entity '${entity.name}'`);
    addUnique(overrides, name, `${overridePath}.action`, "action override");
    const placements = override.placements;
    if (placements !== null) {
      if (placements.length === 0) fail(`${overridePath}.placements`, "must not be empty");
      const seen = new Set<string>();
      placements.forEach((placement, placementIndex) => {
        const allowed = allowedPlacements(action.verb as BeverActionVerb);
        if (!allowed.includes(placement)) fail(`${overridePath}.placements[${placementIndex}]`, `placement '${placement}' is not valid for ${action.verb}`);
        addUnique(seen, placement, `${overridePath}.placements[${placementIndex}]`, "placement");
      });
    }
  });
}

function validateExperience(entity: EntityModel, experience: InputExperiencePresentationModel | null, kind: "creating" | "editing", fields: Map<string, FieldModel>, actions: Map<string, ActionModel>, allActions: ActionModel[], entities: Map<string, EntityModel>, identity: IdentityModel, basePath: string): void {
  if (experience === null) return;
  const path = `${basePath}.${kind}`;
  const modes = kind === "creating" ? ["Page", "Modal", "None"] : ["Page", "Modal", "Inline", "None"];
  if (!modes.includes(experience.mode)) fail(`${path}.mode`, `unsupported ${kind} mode '${experience.mode}'`);
  const requiredVerb = kind === "creating" ? "create" : "update";
  if (experience.mode !== "None" && !actions.has(requiredVerb)) fail(path, `mode '${experience.mode}' requires ${requiredVerb} action`);
  const projection = experience.fields === null ? entity.fields : validateUniqueNonemptyReferences(experience.fields, fields, `${path}.fields`);
  const projected = new Set(projection.map(field => field.name.toLowerCase()));
  const inputs = new Set<string>();
  experience.inputs.forEach((input, index) => {
    const inputPath = `${path}.inputs[${index}]`;
    const field = resolveLocalReference(input.field, fields, `${inputPath}.field`);
    addUnique(inputs, field.name.toLowerCase(), `${inputPath}.field`, "input field");
    if (!projected.has(field.name.toLowerCase())) fail(`${inputPath}.field`, "input field is outside the experience field projection");
    if (field.type?.kind !== "Relationship" || field.type.targets.length !== 1) fail(`${inputPath}.field`, "picker requires a single-target relationship");
    const isIdentity = field.type.targetKind === "SystemIdentity" && field.type.targets[0] === "Identity";
    const target = entities.get(field.type.targets[0].toLowerCase());
    const pickable = isIdentity ? identity.enabled : target !== undefined && (field.type.picker != null || isPickable(target.name, allActions));
    if (!pickable) fail(`${inputPath}.field`, `picker target '${field.type.targets[0]}' must declare Pick or Read`);
  });
}

function validateUniqueNonemptyReferences(references: ReferencePathModel[], fields: Map<string, FieldModel>, path: string): FieldModel[] {
  if (references.length === 0) fail(path, "must not be empty");
  return validateUniqueReferences(references, fields, path);
}

function validateUniqueReferences(references: ReferencePathModel[], fields: Map<string, FieldModel>, path: string): FieldModel[] {
  const seen = new Set<string>();
  return references.map((reference, index) => {
    const field = resolveLocalReference(reference, fields, `${path}[${index}]`);
    addUnique(seen, field.name.toLowerCase(), `${path}[${index}]`, "field reference");
    return field;
  });
}

function resolveLocalReference(reference: ReferencePathModel, fields: Map<string, FieldModel>, path: string): FieldModel {
  if (reference.segments.length !== 1) fail(path, "must be a single-segment local field path");
  const field = fields.get(reference.segments[0]);
  if (field === undefined) fail(path, `unknown field '${reference.segments[0]}'`);
  return field;
}

function validateReferenceShape(value: unknown, path: string): ReferencePathModel {
  const reference = closedObject(value, path, referenceProperties);
  const segments = array(reference.segments, `${path}.segments`);
  segments.forEach((segment, index) => string(segment, `${path}.segments[${index}]`));
  return value as ReferencePathModel;
}

// A field naming a picker needs that named Pick on its target; a relationship in an effective Create/Update
// projection must resolve to a picker; and a relationship target needs a label field.
function validatePickers(entity: EntityModel, actions: ActionModel[], entities: Map<string, EntityModel>, path: string): void {
  const projected = new Set<string>();
  for (const [verb, experience] of [["Create", entity.presentation?.creating ?? null], ["Update", entity.presentation?.editing ?? null]] as const) {
    if (experience?.mode === "None" || !actions.some(action => action.entity === entity.name && action.verb === verb)) continue;
    for (const name of experience?.fields?.map(reference => reference.segments[0]) ?? entity.fields.map(field => field.name)) projected.add(name);
  }
  entity.fields.forEach((field, index) => {
    const type = field.type;
    if (type?.kind !== "Relationship" || type.targetKind !== "Application" || type.targets.length !== 1) return;
    const target = type.targets[0];
    if (type.picker != null && !actions.some(action => action.verb === "Pick" && action.entity === target && action.name === type.picker)) fail(`${path}.fields[${index}].type.picker`, `picker '${type.picker}' is not declared on '${target}'`);
    if (type.picker == null && projected.has(field.name) && !isPickable(target, actions)) fail(`${path}.fields[${index}]`, `relationship target '${target}' declares no Pick or Read, so the field cannot be selected in a form`);
    const targetEntity = entities.get(target.toLowerCase());
    if (targetEntity !== undefined && targetEntity.presentation?.recordLabel == null && defaultLabelField(targetEntity.fields) === undefined) fail(`${path}.fields[${index}]`, `relationship target '${target}' has no field that can label its records`);
  });
}

function isPickable(entity: string, actions: ActionModel[]): boolean {
  return actions.some(action => action.entity === entity && (action.verb === "Read" || (action.verb === "Pick" && action.name === null)));
}

/** Omitted RecordLabel: the first Text field, otherwise the first other non-Boolean label-eligible field. */
export function defaultLabelField(fields: FieldModel[]): FieldModel | undefined {
  return fields.find(field => field.type?.kind === "Primitive" && field.type.name === "Text")
    ?? fields.find(field => field.type?.kind === "Enum" || (field.type?.kind === "Primitive" && ["Email", "Phone", "Url", "Int", "Decimal", "Date", "DateTime"].includes(field.type.name ?? "")));
}

function isDisplayField(field: FieldModel): boolean {
  const type = field.type;
  return type?.kind === "Enum" || (type?.kind === "Primitive" && ["Text", "Email", "Phone", "Url", "Int", "Integer", "Decimal", "Date", "DateTime", "Boolean"].includes(type.name ?? ""));
}

function isSearchableField(field: FieldModel): boolean {
  const type = field.type;
  return type?.kind === "Enum" || (type?.kind === "Primitive" && ["Text", "Email", "Phone", "Url"].includes(type.name ?? ""));
}

function allowedPlacements(verb: BeverActionVerb): string[] {
  if (verb === "Create") return ["ListingToolbar"];
  if (verb === "Read") return ["Navigation", "ListingRow", "DetailsToolbar"];
  return ["ListingRow", "DetailsToolbar"];
}

function isCrudVerb(value: string): value is BeverActionVerb { return (crudVerbs as readonly string[]).includes(value); }
function nullableString(value: unknown, path: string): void { if (value !== null) string(value, path); }
function nullableText(value: unknown, path: string): void { if (value !== null) text(value, path); }
function text(value: unknown, path: string): string { if (typeof value !== "string") fail(path, "must be a string"); return value; }
function string(value: unknown, path: string): string { if (typeof value !== "string" || value.length === 0) fail(path, "must be a nonempty string"); return value; }
function array(value: unknown, path: string): unknown[] { if (!Array.isArray(value)) fail(path, "must be an array"); return value; }
function object(value: unknown, path: string, message = "must be an object"): Record<string, unknown> { if (value === null || typeof value !== "object" || Array.isArray(value)) fail(path, message); return value as Record<string, unknown>; }
function closedObject(value: unknown, path: string, allowed: readonly string[]): Record<string, unknown> {
  const result = object(value, path);
  const expected = new Set(allowed);
  for (const name of Object.keys(result)) if (!expected.has(name)) fail(`${path}.${name}`, "unsupported property");
  for (const name of allowed) if (!(name in result)) fail(`${path}.${name}`, "property is required");
  return result;
}
function addUnique(values: Set<string>, value: string, path: string, description: string): void { if (values.has(value)) fail(path, `duplicate ${description} '${value}'`); values.add(value); }
function fail(path: string, message: string): never { throw new BeverModelValidationError(path, message); }

function rejectDuplicateJsonProperties(json: string): void {
  let index = 0;
  const whitespace = () => { while (/\s/.test(json[index] ?? "")) index++; };
  const parseString = (): string => {
    const start = index++;
    while (index < json.length) {
      if (json[index] === "\\") { index += 2; continue; }
      if (json[index++] === "\"") return JSON.parse(json.slice(start, index));
    }
    fail("$", "unterminated JSON string");
  };
  const scan = (path: string): void => {
    whitespace();
    if (json[index] === "{") {
      index++; whitespace();
      const names = new Set<string>();
      let propertyIndex = 0;
      while (json[index] !== "}" && index < json.length) {
        const name = parseString(); whitespace();
        if (json[index++] !== ":") fail(path, "invalid JSON object");
        if (names.has(name)) fail(path, `duplicate JSON property '${name}'`);
        names.add(name);
        scan(`${path}.${name}`); whitespace(); propertyIndex++;
        if (json[index] !== ",") break;
        index++; whitespace();
      }
      if (json[index++] !== "}") fail(path, "invalid JSON object");
    } else if (json[index] === "[") {
      index++; whitespace(); let item = 0;
      while (json[index] !== "]" && index < json.length) {
        scan(`${path}[${item++}]`); whitespace();
        if (json[index] !== ",") break;
        index++; whitespace();
      }
      if (json[index++] !== "]") fail(path, "invalid JSON array");
    } else if (json[index] === "\"") {
      parseString();
    } else {
      while (index < json.length && !/[\s,\]}]/.test(json[index])) index++;
    }
  };
  scan("$"); whitespace();
  if (index !== json.length) fail("$", "invalid trailing JSON content");
}
