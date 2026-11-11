/**
 * User ke paste kiye hue text se Google Drive file/folder IDs nikalta hai.
 * Support: file/d/<id>/view, open?id=<id>, uc?id=<id>, drive/folders/<id>, bare id.
 */
export function parseDriveInput(text = "") {
  const tokens = String(text)
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const found = new Map();

  const add = (kind, id) => {
    if (!id) return;
    const key = `${kind}:${id}`;
    if (!found.has(key)) found.set(key, { kind, id });
  };

  for (const token of tokens) {
    if (/^[A-Za-z0-9_-]{20,}$/.test(token)) {
      add("file", token);
      continue;
    }

    let url;
    try {
      url = new URL(token);
    } catch {
      continue;
    }
    if (!/(^|\.)google\.com$/i.test(url.hostname)) continue;

    const folder = url.pathname.match(/\/folders\/([A-Za-z0-9_-]{10,})/);
    if (folder) {
      add("folder", folder[1]);
      continue;
    }

    const filePath = url.pathname.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/);
    if (filePath) {
      add("file", filePath[1]);
      continue;
    }

    const docsPath = url.pathname.match(/\/d\/([A-Za-z0-9_-]{10,})/);
    if (docsPath) {
      add("file", docsPath[1]);
      continue;
    }

    const queryId = url.searchParams.get("id");
    if (queryId && /^[A-Za-z0-9_-]{10,}$/.test(queryId)) add("file", queryId);
  }

  return [...found.values()];
}
