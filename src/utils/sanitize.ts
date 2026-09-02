const sensitiveKeyPattern = /(token|password|authorization|connectionString|secret|credential)/i;

export function sanitizeValue(value: unknown, secrets: string[] = []): unknown {
  if (typeof value === 'string') {
    return secrets.reduce((current, secret) => {
      if (!secret) return current;
      return current.split(secret).join('[REDACTED]');
    }, value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, secrets));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        sensitiveKeyPattern.test(key) ? '[REDACTED]' : sanitizeValue(entry, secrets)
      ])
    );
  }

  return value;
}

export function validationIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message
  }));
}
