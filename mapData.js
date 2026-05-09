// mapData.js
// Single responsibility: load and expose all static campaign data.
// No DOM access. No side effects. Just fetch, parse, return.
//
// Everything else imports from here. If you later swap JSON files or
// add an events.json, this is the only file you touch.

export async function loadMapData() {

  // Fetch all files in parallel.
  // lines.json is optional: if the file is missing or unreadable, fall back to [].
  const [campaignRaw, entitiesRaw, pathData, shipPathData, linesData, landData, sessions] = await Promise.all([
    fetch("./data/campaign_default.json").then(r => r.json()),
    fetch("./data/entities.json").then(r => r.json()),
    fetch("./data/path.json").then(r => r.json()),
    fetch("./data/shipPath.json").then(r => r.json()),
    fetch("./data/lines.json")
      .then(r => r.ok ? r.json() : [])
      .catch(() => []),
    fetch("./data/land.json")
      .then(r => r.ok ? r.json() : [])
      .catch(() => []),
    fetch("./data/sessions.json")
      .then(r => r.ok ? r.json() : [])
      .catch(() => []),
  ]);

  // The hex color/note data lives nested inside campaign.hex.data
  // Pull it up to the top level for convenience
  const hexData = campaignRaw.hex?.data ?? {};

  return {
    hexData,
    entities: entitiesRaw,
    pathData,
    linesData,
    shipPathData,
    landData,
    sessions,
  };
}
