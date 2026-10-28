export function entityRouteName(entityName: string): string {
  return pluralize(toKebabCase(entityName));
}

export function toRequestFieldName(fieldName: string): string {
  return fieldName.length === 0 ? fieldName : fieldName[0].toLowerCase() + fieldName.slice(1);
}

export function joinUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = normalizePrefix(path);
  return normalizedBase.length === 0 ? normalizedPath || "/" : normalizedBase + normalizedPath;
}

export function normalizePrefix(prefix: string): string {
  const trimmed = prefix.trim();
  if (trimmed.length === 0 || trimmed === "/") {
    return "";
  }

  return "/" + trimmed.replace(/^\/+|\/+$/g, "");
}

function toKebabCase(value: string): string {
  let result = "";

  for (let index = 0; index < value.length; index++) {
    const current = value[index];
    if (/\s|_|-/.test(current)) {
      result = appendDash(result);
      continue;
    }

    if (isUpper(current) && result.length > 0 && !result.endsWith("-")) {
      const previous = value[index - 1];
      const next = value[index + 1];
      if (isLower(previous) || isDigit(previous) || (next !== undefined && isLower(next))) {
        result += "-";
      }
    }

    result += current.toLowerCase();
  }

  return result.replace(/^-+|-+$/g, "");
}

function appendDash(value: string): string {
  return value.length > 0 && !value.endsWith("-") ? value + "-" : value;
}

function pluralize(value: string): string {
  if (value.endsWith("y") && value.length > 1 && !isVowel(value[value.length - 2])) {
    return value.slice(0, -1) + "ies";
  }

  if (
    value.endsWith("s") ||
    value.endsWith("x") ||
    value.endsWith("z") ||
    value.endsWith("ch") ||
    value.endsWith("sh")
  ) {
    return value + "es";
  }

  return value + "s";
}

function isUpper(value: string): boolean {
  return value >= "A" && value <= "Z";
}

function isLower(value: string): boolean {
  return value >= "a" && value <= "z";
}

function isDigit(value: string): boolean {
  return value >= "0" && value <= "9";
}

function isVowel(value: string): boolean {
  return value === "a" || value === "e" || value === "i" || value === "o" || value === "u";
}
