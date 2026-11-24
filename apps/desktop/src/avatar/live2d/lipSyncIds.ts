/** The model's lip-sync parameters: its `LipSync` group, falling back to the standard mouth parameter. */
export function lipSyncIds(internal: unknown, known: Record<string, number>): string[] {
  const json = (internal as { settings?: { json?: { Groups?: Array<{ Target?: string; Name?: string; Ids?: string[] }> } } }).settings?.json;
  const declared = json?.Groups?.find((g) => g.Target === "Parameter" && g.Name === "LipSync")?.Ids?.filter((id) => id in known) ?? [];
  if (declared.length) return declared;
  return "ParamMouthOpenY" in known ? ["ParamMouthOpenY"] : [];
}
