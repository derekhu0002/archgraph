'use strict';

// Curated embedding text for a canonical semantic record.
//
// The canonical JSON (design/KG/SystemArchitecture.json) remains the structural
// source of truth. The vector index, however, only encodes the human-meaningful
// fields of each record — never ids, endpoint ids, view member-id arrays, or
// JSON syntax — because embedding the raw object measurably dilutes retrieval
// (most severely for Views, whose member-id arrays dominate the text, and for
// Relationships, which are mostly structural). Both the full backfill and the
// incremental mutation lifecycle MUST embed through this single composer so the
// indexed text is identical across both paths.

function meaningful(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function formatAttributes(attributes) {
  if (!Array.isArray(attributes)) {
    return [];
  }
  const lines = [];
  for (const attribute of attributes) {
    if (!attribute || !meaningful(attribute.name)) {
      continue;
    }
    const detail = meaningful(attribute.value)
      ? attribute.value
      : (meaningful(attribute.description) ? attribute.description : '');
    lines.push(detail ? `${attribute.name.trim()}: ${detail.trim()}` : attribute.name.trim());
  }
  return lines;
}

function buildSemanticRecordText(channel, object) {
  const record = object && typeof object === 'object' ? object : {};
  const lines = [];
  const add = value => {
    if (meaningful(value)) {
      lines.push(value.trim());
    }
  };

  if (channel === 'ArchitectureRelationship' || channel === 'Relationship') {
    add(record.statement);
    add(record.name);
    add(record.description);
    add(record.document);
    lines.push(...formatAttributes(record.attributes));
    return lines.join('\n');
  }

  if (channel === 'View') {
    add(record.view_name);
    add(record.description);
    return lines.join('\n');
  }

  // Element (default channel)
  add(record.type);
  add(record.name);
  add(record.alias);
  add(record.description);
  lines.push(...formatAttributes(record.attributes));
  if (Array.isArray(record.testcases)) {
    for (const testcase of record.testcases) {
      if (testcase && meaningful(testcase.description)) {
        lines.push(testcase.description.trim());
      }
    }
  }
  return lines.join('\n');
}

module.exports = { buildSemanticRecordText };
