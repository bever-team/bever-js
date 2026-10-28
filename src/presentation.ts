import type {
  ActionModel,
  ActionPresentationEmphasis,
  ActionPresentationPlacement,
  BeverActionVerb,
  EntityModel,
  FieldModel,
  InputExperienceMode,
  InputPresentationModel
} from "./model.js";
import { entityRouteName } from "./routes.js";
import { defaultLabelField } from "./validation.js";

export interface ResolvedPresentationField {
  readonly field: FieldModel;
  readonly label: string;
}

export interface UnsupportedReferenceSelectionCapability {
  readonly supported: false;
  readonly code: "UnsupportedReferenceSelection";
  readonly message: string;
}
export type UnsupportedPickerSearchCapability = UnsupportedReferenceSelectionCapability;

export interface ApplicationReferenceLookupCapability {
  readonly supported: true;
  readonly kind: "Application";
  readonly targetEntity: EntityModel;
  readonly targetRouteName: string;
  /** Named picker passed to lookup; null uses the target's default picker. */
  readonly picker: string | null;
  readonly searchable: boolean;
  readonly searchFields: FieldModel[];
  readonly recordLabel: ResolvedRecordLabel;
}

export interface SystemIdentityReferenceLookupCapability {
  readonly supported: true;
  readonly kind: "SystemIdentity";
  readonly targetRouteName: string;
  readonly searchable: boolean;
  readonly searchFields: FieldModel[];
  readonly recordLabel: ResolvedRecordLabel;
}

export type ReferenceLookupCapability = ApplicationReferenceLookupCapability | SystemIdentityReferenceLookupCapability;

export type ReferenceSelectionCapability = ReferenceLookupCapability | UnsupportedReferenceSelectionCapability;

export interface ResolvedInputPresentation {
  readonly field: FieldModel;
  readonly widget: "ReferencePicker";
  readonly display: "Dropdown" | "Combobox" | "Modal";
  readonly capability: ReferenceSelectionCapability;
  /** @deprecated use capability */
  readonly searchCapability?: UnsupportedReferenceSelectionCapability;
}

export interface ResolvedInputExperiencePresentation {
  readonly mode: InputExperienceMode;
  readonly fields: ResolvedPresentationField[];
  readonly inputs: ResolvedInputPresentation[];
}

/** A record's label field, or None when it has no label field: never the record ID. */
export type ResolvedRecordLabel =
  | { readonly kind: "Field"; readonly field: FieldModel }
  | { readonly kind: "None" };

export interface ResolvedActionPresentation {
  readonly action: ActionModel;
  readonly label: string;
  readonly emphasis: ActionPresentationEmphasis;
  readonly confirm: string | null;
  readonly placements: ActionPresentationPlacement[];
  readonly order: number;
  readonly hidden: boolean;
}

export interface ResolvedEntityPresentation {
  readonly label: string;
  readonly pluralLabel: string;
  readonly recordLabel: ResolvedRecordLabel;
  readonly fields: ResolvedPresentationField[];
  readonly listing: ResolvedPresentationField[];
  readonly details: ResolvedPresentationField[];
  readonly creating: ResolvedInputExperiencePresentation;
  readonly editing: ResolvedInputExperiencePresentation;
  readonly actions: ResolvedActionPresentation[];
  getActionsForPlacement(placement: ActionPresentationPlacement): ResolvedActionPresentation[];
}

const actionDefaults: Record<BeverActionVerb, {
  label: string;
  emphasis: ActionPresentationEmphasis;
  confirm: string | null;
  placements: ActionPresentationPlacement[];
}> = {
  Create: { label: "Create", emphasis: "Primary", confirm: null, placements: ["ListingToolbar"] },
  Read: { label: "View", emphasis: "Default", confirm: null, placements: ["Navigation", "ListingRow"] },
  Update: { label: "Edit", emphasis: "Default", confirm: null, placements: ["ListingRow", "DetailsToolbar"] },
  Delete: { label: "Delete", emphasis: "Destructive", confirm: "Delete this record?", placements: ["ListingRow", "DetailsToolbar"] }
};

export function unsupportedPickerSearchCapability(_input?: InputPresentationModel): UnsupportedReferenceSelectionCapability {
  return {
    supported: false,
    code: "UnsupportedReferenceSelection",
    message: "Reference selection is unavailable because the relationship target has no picker."
  };
}

export function resolveEntityPresentation(entity: EntityModel, allEntities: EntityModel[] | ActionModel[], actions?: ActionModel[]): ResolvedEntityPresentation {
  const entities = actions === undefined ? [entity] : allEntities as EntityModel[];
  const modelActions = actions ?? allEntities as ActionModel[];
  const presentation = entity.presentation;
  const fieldsByName = new Map(entity.fields.map(field => [field.name.toLowerCase(), field]));
  const fieldLabels = new Map(
    (presentation?.fields ?? []).map(item => [referenceName(item.field), item.label])
  );
  const resolveField = (field: FieldModel): ResolvedPresentationField => ({
    field,
    label: fieldLabels.get(field.name.toLowerCase()) ?? humanize(field.name)
  });
  const projection = (references: { segments: string[] }[] | null | undefined): ResolvedPresentationField[] =>
    references === null || references === undefined
      ? entity.fields.map(resolveField)
      : references.map(reference => resolveField(fieldsByName.get(referenceName(reference))!));

  const entitiesByName = new Map(entities.map(item => [item.name.toLowerCase(), item]));
  // Pick actions serve pickers only; they have no generated control.
  const entityActions = modelActions.filter(action => action.entity.toLowerCase() === entity.name.toLowerCase() && action.verb !== "Pick");
  const overrides = new Map((presentation?.actionOverrides ?? []).map(override => [override.action.name.toLowerCase(), override]));
  const resolvedActions = entityActions.map(action => {
    const verb = action.verb as BeverActionVerb;
    const defaults = actionDefaults[verb];
    const override = overrides.get(verb.toLowerCase());
    return {
      action,
      label: override?.label ?? defaults.label,
      emphasis: override?.emphasis ?? defaults.emphasis,
      confirm: override?.confirm ?? defaults.confirm,
      placements: [...(override?.placements ?? defaults.placements)],
      order: override?.order ?? 0,
      hidden: override?.hidden ?? false
    } satisfies ResolvedActionPresentation;
  }).sort(compareActions);

  const creatingMode = presentation?.creating?.mode ?? (entityActions.some(action => action.verb === "Create") ? "Page" : "None");
  const editingMode = presentation?.editing?.mode ?? (entityActions.some(action => action.verb === "Update") ? "Page" : "None");
  const resolveInputs = (inputs: InputPresentationModel[] | undefined, projectedFields: ResolvedPresentationField[]): ResolvedInputPresentation[] => {
    const explicit = new Map((inputs ?? []).map(input => [referenceName(input.field), input]));
    const resolved: ResolvedInputPresentation[] = [];
    for (const item of projectedFields) {
      const field = item.field;
      const explicitInput = explicit.get(field.name.toLowerCase());
      if (explicitInput === undefined && field.type?.kind !== "Relationship") continue;
      if (field.type?.kind !== "Relationship" || field.type.targets.length !== 1) continue;
      const isIdentity = field.type.targetKind === "SystemIdentity" && field.type.targets[0] === "Identity";
      const target = entitiesByName.get(field.type.targets[0].toLowerCase());
      const capability = isIdentity ? resolveIdentityLookupCapability() : target === undefined ? unsupportedPickerSearchCapability() : resolveLookupCapability(target, modelActions, field.type.picker ?? null);
      const unsupported = capability.supported ? undefined : capability;
      resolved.push({
        field,
        widget: "ReferencePicker",
        display: explicitInput?.display ?? "Combobox",
        capability,
        ...(unsupported === undefined ? {} : { searchCapability: unsupported })
      });
    }
    return resolved;
  };

  const creatingFields = projection(presentation?.creating?.fields);
  const editingFields = projection(presentation?.editing?.fields);

  const result: ResolvedEntityPresentation = {
    label: presentation?.label ?? humanize(entity.name),
    pluralLabel: presentation?.pluralLabel ?? pluralizeLabel(presentation?.label ?? humanize(entity.name)),
    recordLabel: presentation?.recordLabel !== null && presentation?.recordLabel !== undefined
      ? { kind: "Field", field: fieldsByName.get(referenceName(presentation.recordLabel))! }
      : defaultRecordLabel(entity.fields),
    fields: entity.fields.map(resolveField),
    listing: projection(presentation?.listing?.fields),
    details: projection(presentation?.details?.fields),
    creating: {
      mode: creatingMode,
      fields: creatingFields,
      inputs: resolveInputs(presentation?.creating?.inputs, creatingFields)
    },
    editing: {
      mode: editingMode,
      fields: editingFields,
      inputs: resolveInputs(presentation?.editing?.inputs, editingFields)
    },
    actions: resolvedActions,
    getActionsForPlacement(placement) {
      return resolvedActions.filter(descriptor =>
        !descriptor.hidden
        && descriptor.placements.includes(placement)
        && !(descriptor.action.verb === "Create" && creatingMode === "None")
        && !(descriptor.action.verb === "Update" && editingMode === "None"));
    }
  };
  return result;
}

/** The named picker, otherwise the target's default Pick, otherwise its Read. */
export function resolveLookupCapability(target: EntityModel, actions: ActionModel[], picker: string | null = null): ReferenceSelectionCapability {
  const targetActions = actions.filter(action => action.entity.toLowerCase() === target.name.toLowerCase());
  const pickerAction = picker !== null
    ? targetActions.find(action => action.verb === "Pick" && action.name?.toLowerCase() === picker.toLowerCase())
    : targetActions.find(action => action.verb === "Pick" && action.name === null) ?? targetActions.find(action => action.verb === "Read");
  if (pickerAction === undefined) return unsupportedPickerSearchCapability();
  const label = target.presentation?.recordLabel !== null && target.presentation?.recordLabel !== undefined
    ? { kind: "Field" as const, field: target.fields.find(field => field.name.toLowerCase() === referenceName(target.presentation!.recordLabel!))! }
    : defaultRecordLabel(target.fields);
  const fieldsByName = new Map(target.fields.map(field => [field.name.toLowerCase(), field]));
  const searchFields = pickerAction.searchBy !== null
    ? pickerAction.searchBy.map(reference => fieldsByName.get(referenceName(reference))!).filter(Boolean)
    : label.kind === "Field" && isSearchableField(label.field) ? [label.field] : [];
  return {
    supported: true,
    kind: "Application",
    targetEntity: target,
    targetRouteName: entityRouteName(target.name),
    picker: pickerAction.name,
    searchable: searchFields.length > 0,
    searchFields,
    recordLabel: label
  };
}

export function resolveIdentityLookupCapability(): ReferenceSelectionCapability {
  return {
    supported: true,
    kind: "SystemIdentity",
    targetRouteName: "identity",
    searchable: true,
    searchFields: [],
    recordLabel: { kind: "None" }
  };
}

/** A readable label for a model name: "DueDate" becomes "Due date", "SKUCode" becomes "SKU code". */
export function humanize(name: string): string {
  const words = name.match(/[A-Z]+(?=[A-Z][a-z]|[0-9]|$)|[A-Z]?[a-z]+|[0-9]+/g) ?? [name];
  return words
    .map((word, index) => index === 0 || /^[A-Z0-9]+$/.test(word) && word.length > 1 ? word : word.toLowerCase())
    .map((word, index) => index === 0 ? word[0].toUpperCase() + word.slice(1) : word)
    .join(" ");
}

/** The plural of a label's last word: "Sales order" becomes "Sales orders", "Category" becomes "Categories". */
export function pluralizeLabel(label: string): string {
  const match = /^(.*?)([A-Za-z]+)$/.exec(label);
  if (match === null) return label;
  const [, head, word] = match;
  if (word.length > 1 && word === word.toUpperCase()) return head + word + "s";
  if (/[^aeiou]y$/i.test(word)) return head + word.slice(0, -1) + "ies";
  if (/(s|x|z|ch|sh)$/i.test(word)) return head + word + "es";
  return head + word + "s";
}

function referenceName(reference: { segments: string[] }): string {
  return reference.segments[0].toLowerCase();
}

function defaultRecordLabel(fields: FieldModel[]): ResolvedRecordLabel {
  const field = defaultLabelField(fields);
  return field === undefined ? { kind: "None" } : { kind: "Field", field };
}

function isSearchableField(field: FieldModel): boolean {
  const type = field.type;
  return type?.kind === "Enum" || (type?.kind === "Primitive" && ["Text", "Email", "Phone", "Url"].includes(type.name ?? ""));
}

function compareActions(left: ResolvedActionPresentation, right: ResolvedActionPresentation): number {
  return left.order - right.order || actionRank(left.action.verb as BeverActionVerb) - actionRank(right.action.verb as BeverActionVerb);
}

function actionRank(verb: BeverActionVerb): number {
  if (verb === "Create") return 0;
  if (verb === "Read") return 1;
  if (verb === "Update") return 2;
  return 3;
}
