export { createBeverApp } from "./app.js";
export type { BeverApp, BeverEntity } from "./app.js";

export { BeverApiContractError, BeverHttpError, createBeverClient } from "./client.js";
export type { BeverClient, BeverClientOptions, BeverRecord, FetchLike, IdentityAccount, IdentityAccountsRequest, IdentityAccountsResponse, IdentityCredentialRequest, IdentityLookupContext, IdentitySession, IdentitySummary, ReferenceHydrationRequest, ReferenceHydrationResponse, ReferenceLookupRequest, ReferenceLookupResponse, ReferenceSummary, RequestOptions } from "./client.js";

export { entityRouteName, joinUrl, normalizePrefix, toRequestFieldName } from "./routes.js";

export { humanize, pluralizeLabel, resolveEntityPresentation, resolveIdentityLookupCapability, resolveLookupCapability, unsupportedPickerSearchCapability } from "./presentation.js";
export type {
  ResolvedActionPresentation,
  ResolvedEntityPresentation,
  ResolvedInputExperiencePresentation,
  ResolvedInputPresentation,
  ResolvedPresentationField,
  ResolvedRecordLabel,
  ApplicationReferenceLookupCapability,
  ReferenceLookupCapability,
  ReferenceSelectionCapability,
  SystemIdentityReferenceLookupCapability,
  UnsupportedReferenceSelectionCapability,
  UnsupportedPickerSearchCapability
} from "./presentation.js";

export {
  BeverModelValidationError,
  BeverModelVersionError,
  parseBeverModel,
  SUPPORTED_SEMANTIC_MODEL_VERSION,
  validateBeverModel
} from "./validation.js";

export type {
  ActionModel,
  ActionPresentationEmphasis,
  ActionPresentationOverrideModel,
  ActionPresentationPlacement,
  ActionReferenceModel,
  AuthorizationModel,
  BeverActionVerb,
  BeverModel,
  ComparisonOperator,
  EntityMetadata,
  EntityModel,
  EntityPresentationModel,
  EnumOptionModel,
  ExpressionKind,
  ExpressionModel,
  FieldModel,
  FieldTypeModel,
  IdentityCapability,
  IdentityModel,
  IdentitySummaryModel,
  IdentitySystemTargetModel,
  InputExperienceMode,
  InputExperiencePresentationModel,
  InputPresentationModel,
  LiteralValueModel,
  OrderByModel,
  PrimitiveTypeName,
  PresentationFieldModel,
  PresentationSurfaceModel,
  ReferencePathModel,
  RoleModel,
  RuleModel,
  SourceLocation,
  SourceSpan
} from "./model.js";
