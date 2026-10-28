import type { ActionModel, BeverModel, EntityModel, FieldModel } from "./model.js";
import type { ResolvedEntityPresentation } from "./presentation.js";
import { resolveEntityPresentation } from "./presentation.js";
import { entityRouteName, toRequestFieldName } from "./routes.js";
import { validateBeverModel } from "./validation.js";

export interface BeverApp {
  readonly model: BeverModel;
  readonly entities: BeverEntity[];
  readonly actions: ActionModel[];
  getEntity(name: string): BeverEntity | undefined;
  requireEntity(name: string): BeverEntity;
  getActions(entityName?: string): ActionModel[];
}

export interface BeverEntity {
  readonly model: EntityModel;
  readonly name: string;
  readonly routeName: string;
  readonly presentation: ResolvedEntityPresentation;
  getFields(): FieldModel[];
  getField(name: string): FieldModel | undefined;
  requireField(name: string): FieldModel;
  getRequestFieldName(field: FieldModel | string): string;
}

export function createBeverApp(model: BeverModel): BeverApp {
  validateBeverModel(model);
  const entities = model.entities.map(entity => createBeverEntity(entity, model.entities, model.actions));
  const entitiesByName = new Map(entities.map((entity) => [entity.name.toLowerCase(), entity]));

  return {
    model,
    entities,
    actions: model.actions,
    getEntity(name) {
      return entitiesByName.get(name.toLowerCase());
    },
    requireEntity(name) {
      const entity = this.getEntity(name);
      if (entity === undefined) {
        throw new Error(`Bever entity '${name}' was not found.`);
      }

      return entity;
    },
    getActions(entityName) {
      if (entityName === undefined) {
        return model.actions;
      }

      return model.actions.filter((action) => action.entity.toLowerCase() === entityName.toLowerCase());
    }
  };
}

function createBeverEntity(model: EntityModel, entities: EntityModel[], actions: ActionModel[]): BeverEntity {
  const fieldsByName = new Map(model.fields.map((field) => [field.name.toLowerCase(), field]));

  return {
    model,
    name: model.name,
    routeName: entityRouteName(model.name),
    presentation: resolveEntityPresentation(model, entities, actions),
    getFields() {
      return model.fields;
    },
    getField(name) {
      return fieldsByName.get(name.toLowerCase());
    },
    requireField(name) {
      const field = this.getField(name);
      if (field === undefined) {
        throw new Error(`Bever field '${model.name}.${name}' was not found.`);
      }

      return field;
    },
    getRequestFieldName(field) {
      return toRequestFieldName(typeof field === "string" ? field : field.name);
    }
  };
}
