export interface BeverModel {
  beverLanguageVersion: string;
  semanticModelVersion: "0.10";
  identity: IdentityModel;
  roles: RoleModel[];
  entities: EntityModel[];
  actions: ActionModel[];
}

/** A role declared with `Role <Name>`. Accounts are assigned to roles outside the model. */
export interface RoleModel {
  name: string;
  sourceSpan?: SourceSpan | null;
}

export interface EntityModel {
  name: string;
  kind: "Application";
  sourceSpan?: SourceSpan | null;
  fields: FieldModel[];
  rules: RuleModel[];
  presentation: EntityPresentationModel | null;
}

/** A validation rule. The server refuses a create or update when `condition` is false for the resulting record. */
export interface RuleModel {
  condition: ExpressionModel;
  message: string;
  sourceSpan?: SourceSpan | null;
}

export type ExpressionKind = "And" | "Or" | "Not" | "Compare" | "In" | "Field" | "Literal" | "Null" | "Today" | "Now";

export type ComparisonOperator = "=" | "!=" | "<" | "<=" | ">" | ">=";

/** A rule condition node; `operator` is set on `Compare`, `path` on `Field`, and `literal` on `Literal`. */
export interface ExpressionModel {
  kind: ExpressionKind;
  operator: ComparisonOperator | null;
  operands: ExpressionModel[];
  path: ReferencePathModel | null;
  literal: LiteralValueModel | null;
}

export interface IdentityModel {
  enabled: boolean;
  capabilities: IdentityCapability[];
  summary: IdentitySummaryModel | null;
  systemTargets: IdentitySystemTargetModel[];
}

export type IdentityCapability = "Login" | "Logout" | "Session" | "Register";

export interface IdentitySummaryModel { labelSource: "Email" }

export interface IdentitySystemTargetModel {
  name: "Identity";
  kind: "SystemIdentity";
  lookup: {
    summaryShape: "IdLabel";
    contextBound: true;
    generalReadAction: false;
  };
}

export interface EntityPresentationModel {
  label: string | null;
  pluralLabel: string | null;
  recordLabel: ReferencePathModel | null;
  fields: PresentationFieldModel[];
  listing: PresentationSurfaceModel | null;
  details: PresentationSurfaceModel | null;
  creating: InputExperiencePresentationModel | null;
  editing: InputExperiencePresentationModel | null;
  actionOverrides: ActionPresentationOverrideModel[];
  sourceSpan: SourceSpan | null;
}

export interface PresentationSurfaceModel {
  fields: ReferencePathModel[] | null;
  sourceSpan: SourceSpan | null;
}

export type InputExperienceMode = "Page" | "Modal" | "Inline" | "None";

export interface InputExperiencePresentationModel {
  mode: InputExperienceMode;
  fields: ReferencePathModel[] | null;
  inputs: InputPresentationModel[];
  sourceSpan: SourceSpan | null;
}

export interface PresentationFieldModel {
  field: ReferencePathModel;
  label: string;
  sourceSpan: SourceSpan | null;
}

export interface InputPresentationModel {
  field: ReferencePathModel;
  widget: "ReferencePicker";
  display: "Dropdown" | "Combobox" | "Modal";
  sourceSpan: SourceSpan | null;
}

export type ActionPresentationEmphasis = "Default" | "Primary" | "Destructive";
export type ActionPresentationPlacement = "Navigation" | "ListingToolbar" | "ListingRow" | "DetailsToolbar";

export interface ActionPresentationOverrideModel {
  action: ActionReferenceModel;
  label: string | null;
  emphasis: ActionPresentationEmphasis | null;
  confirm: string | null;
  placements: ActionPresentationPlacement[] | null;
  order: number | null;
  hidden: boolean | null;
  sourceSpan: SourceSpan | null;
}

export interface ActionReferenceModel {
  name: BeverActionVerb;
}

export interface FieldModel {
  name: string;
  type?: FieldTypeModel | null;
  defaultValue?: LiteralValueModel | null;
  sourceSpan?: SourceSpan | null;
}

/** Primitive field types. Values travel as JSON strings except Boolean (boolean) and Int, Decimal, Money (number). */
export type PrimitiveTypeName = "Text" | "Boolean" | "Int" | "Decimal" | "Money" | "Date" | "DateTime" | "Time" | "Email" | "Phone" | "Url";

export interface FieldTypeModel {
  kind: "Primitive" | "Enum" | "Relationship";
  /** The primitive type; null for enums and relationships. */
  name?: PrimitiveTypeName | null;
  nullable: boolean;
  arguments: Record<string, unknown>[];
  options: EnumOptionModel[];
  targets: string[];
  onDelete?: "Restrict" | "Cascade" | "SetNull" | null;
  targetKind?: "Application" | "SystemIdentity" | null;
  /** Named picker on the target entity; null uses the target's default Pick, otherwise its Read. */
  picker?: string | null;
}

export interface EnumOptionModel {
  name: string;
  value?: unknown;
}

export interface LiteralValueModel {
  kind: string;
  value?: unknown;
}

export interface ActionModel {
  verb: BeverActionVerb | "Pick";
  entity: string;
  /** Picker name; non-null only on named Pick actions. */
  name: string | null;
  sourceSpan?: SourceSpan | null;
  authorizations: AuthorizationModel[];
  orderBy?: OrderByModel | null;
  searchBy: ReferencePathModel[] | null;
}

export type BeverActionVerb = "Create" | "Read" | "Update" | "Delete";

export interface AuthorizationModel {
  kind: "Anyone" | "Authenticated" | "Path" | "Role";
  path?: ReferencePathModel | null;
  /** The role name; non-null only on Role authorizations. */
  role: string | null;
}

export interface OrderByModel {
  path?: ReferencePathModel | null;
  direction: "Asc" | "Desc";
}

export interface ReferencePathModel {
  segments: string[];
}

export interface SourceSpan {
  start: SourceLocation;
  end: SourceLocation;
}

export interface SourceLocation {
  path: string;
  line: number;
  column: number;
}

export interface EntityMetadata {
  name: string;
  routeName: string;
  fields: FieldModel[];
}
