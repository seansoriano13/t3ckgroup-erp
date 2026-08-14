export const formatTaskPreview = (description, checklist = null) => {
  let descText = "";
  let checklistText = "";

  // 1. Check explicit checklist
  if (checklist) {
    let items = [];
    if (typeof checklist === "string") {
      try {
        const parsed = JSON.parse(checklist);
        items = Array.isArray(parsed) ? parsed : parsed?.items || [];
      } catch {}
    } else {
      items = Array.isArray(checklist) ? checklist : checklist?.items || [];
    }
    if (items.length > 0) {
      checklistText = `Checklist: ${items.length} Items`;
    }
  }

  // 2. Process description (which might be legacy JSON)
  if (description) {
    if (typeof description !== "string") {
      if (Array.isArray(description)) {
        if (!checklistText)
          checklistText = `Checklist: ${description.length} Items`;
      } else if (description && Array.isArray(description.items)) {
        if (!checklistText) {
          checklistText = description.title
            ? `${description.title} (${description.items.length} Items)`
            : `Checklist: ${description.items.length} Items`;
        }
      } else {
        descText = String(description);
      }
    } else {
      const trimmed = description.trim();
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            if (!checklistText)
              checklistText = `Checklist: ${parsed.length} Items`;
          } else {
            descText = description;
          }
        } catch {
          descText = description;
        }
      } else if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && Array.isArray(parsed.items)) {
            if (!checklistText) {
              checklistText = parsed.title
                ? `${parsed.title} (${parsed.items.length} Items)`
                : `Checklist: ${parsed.items.length} Items`;
            }
          } else {
            descText = description;
          }
        } catch {
          descText = description;
        }
      } else {
        descText = description;
      }
    }
  }

  // Combine
  if (descText && checklistText) {
    const maxLen = 40;
    const truncatedDesc =
      descText.length > maxLen
        ? descText.substring(0, maxLen) + "..."
        : descText;
    return `${truncatedDesc} (${checklistText})`;
  } else if (descText) {
    return descText;
  } else if (checklistText) {
    return checklistText;
  }

  return "";
};

export const formatChecklistToString = (description) => {
  if (!description) return "";
  
  if (typeof description !== 'string') {
    if (Array.isArray(description)) {
      return description.map(item => `• ${item.text || 'Task'}`).join('\n');
    } else if (description && Array.isArray(description.items)) {
      const prefix = description.title ? `${description.title}\n` : "";
      return prefix + description.items.map(item => `• ${item.text || 'Task'}`).join('\n');
    }
    return String(description);
  }

  const trimmed = description.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map(item => `• ${item.text || 'Task'}`).join('\n');
      }
    } catch {
      // Not valid JSON
    }
  } else if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && Array.isArray(parsed.items)) {
        const prefix = parsed.title ? `${parsed.title}\n` : "";
        return prefix + parsed.items.map(item => `• ${item.text || 'Task'}`).join('\n');
      }
    } catch {
      // Not valid JSON
    }
  }

  return description;
};

export const extractOthersDetailsFromRemarks = (remarks) => {
  if (!remarks || typeof remarks !== "string") return null;
  const trimmed = remarks.trim();

  const globalOthersMatch = trimmed.match(/^\[OTHERS\]\s*(.+)$/i);
  if (globalOthersMatch?.[1]) return globalOthersMatch[1].trim();

  const committeeOthersMatch = trimmed.match(
    /^\[COMMITTEE\s*-\s*OTHERS\]\s*(.+)$/i,
  );
  if (committeeOthersMatch?.[1]) return committeeOthersMatch[1].trim();

  return null;
};

export const isCategoryMetadataRemarks = (remarks) => {
  if (!remarks || typeof remarks !== "string") return false;
  const trimmed = remarks.trim();
  return (
    /^\[OTHERS\]\s+.+$/i.test(trimmed) ||
    /^\[COMMITTEE\s*-\s*OTHERS\]\s+.+$/i.test(trimmed) ||
    /^\[COMMITTEE\s*-\s*[A-Z\s]+\]$/i.test(trimmed)
  );
};
