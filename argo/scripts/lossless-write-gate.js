'use strict';

/**
 * Lossless Write Gate (无损写入门禁), framework-level.
 *
 * Invariant: NO SILENT LOSS. A write must never reduce stored content unless the
 * caller explicitly acknowledges it (and, for major loss, justifies it). Two
 * mechanisms make this possible:
 *
 *   G1 structured fields MERGE (omission never means deletion): updateElement
 *      .testcases (by name), updateRelationship .attributes (by name),
 *      updateView membership (delta {add,remove}); explicit op:'remove' deletes.
 *   G2 scalar text GUARDED: description / statement / document / name / view_name
 *      are full-value fields; a value that drops prior segments is blocked unless
 *      the mutation carries acknowledgeLoss:true (and lossJustification for major
 *      loss). Pure additions/expansions are always allowed.
 *   G3 destructive removals ACKNOWLEDGED + RECOVERABLE: removeElement /
 *      removeRelationship / removeView require acknowledgeLoss:true and snapshot
 *      the full removed object into a tombstone ledger (nothing is truly lost).
 *   G5 every response carries a loss report (text/testcases/members/objects +
 *      the removed samples), on preview as well as apply.
 *
 * The gate is enforced at the single funnel buildMutationResult (apply +
 * preview + all single-object helpers), so every MCP write interface is covered.
 */

const fs = require('node:fs');
const path = require('node:path');

const LOSS_ACK_FIELD = 'acknowledgeLoss';
const LOSS_JUSTIFICATION_FIELD = 'lossJustification';

// A text loss is "major" (justification, not just acknowledgement, required)
// when it removes this many characters or this share of the original text.
const MAJOR_REMOVED_CHARS = 200;
const MAJOR_REMOVED_RATIO = 0.5;

// A changed segment is a "modification" (not a loss) when its token overlap with
// some new segment is at least this high — "reworded, not dropped".
const MODIFICATION_SIMILARITY = 0.5;

// Tokens that carry structured identity (ids, numbers, hashes, paths): if one is
// gone it is always a loss, even when the surrounding sentence was only reworded.
const TOKEN_RE = /[A-Za-z0-9_@#./\\:-]+|[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;

// Full-value text fields per mutation type. Editing any of these can silently
// drop prior content, so they are loss-guarded.
const TEXT_FIELDS_BY_MUTATION = Object.freeze({
  updateElement: Object.freeze(['description', 'name']),
  updateRelationship: Object.freeze(['statement', 'name', 'description', 'document']),
  updateView: Object.freeze(['view_name', 'description']),
});

function normalizeForCompare(value) {
  return String(value === undefined || value === null ? '' : value)
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSegments(text) {
  return String(text === undefined || text === null ? '' : text)
    .split(/\r?\n/)
    .map(normalizeForCompare)
    .filter(segment => segment.length > 0);
}

function tokenize(segment) {
  const matches = String(segment === undefined || segment === null ? '' : segment).match(TOKEN_RE);
  return matches ? matches.map(token => token.toLowerCase()) : [];
}

function isStructuredToken(token) {
  return /[0-9]/.test(token) || /[/\\]/.test(token) || /^[0-9a-f]{7,40}$/i.test(token);
}

// Sørensen–Dice coefficient over token sets (deterministic, no network).
function diceCoefficient(aTokens, bTokens) {
  if (aTokens.length === 0 && bTokens.length === 0) return 1;
  if (aTokens.length === 0 || bTokens.length === 0) return 0;
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return (2 * intersection) / (a.size + b.size);
}

// Deterministic loss detector. A changed segment is classified as a MODIFICATION
// (kept, just reworded) when it is similar enough to some new segment; otherwise
// it is a LOSS (dropped or substantially rewritten). Structured tokens (ids,
// numbers, hashes, paths) that disappear are always a loss. Pure additions and
// reorderings report nothing.
function detectTextLoss(oldText, newText) {
  const oldSegments = normalizeSegments(oldText);
  if (oldSegments.length === 0) {
    return { removedSegments: [], modifiedSegments: [], removedChars: 0, oldChars: 0, ratio: 0, structuredTokensRemoved: [] };
  }
  const newSegments = normalizeSegments(newText);
  const newNormalized = normalizeForCompare(newText);
  const newTokenSet = new Set(newSegments.flatMap(tokenize));
  const newSegmentTokens = newSegments.map(tokenize);
  const removedSegments = [];
  const modifiedSegments = [];
  const structuredTokensRemoved = [];
  for (const segment of oldSegments) {
    const segmentTokens = tokenize(segment);
    for (const token of segmentTokens) {
      if (isStructuredToken(token) && !newTokenSet.has(token)) structuredTokensRemoved.push(token);
    }
    if (newNormalized.includes(segment)) continue; // kept verbatim
    const best = newSegmentTokens.reduce((max, tokens) => Math.max(max, diceCoefficient(segmentTokens, tokens)), 0);
    if (best >= MODIFICATION_SIMILARITY) modifiedSegments.push(segment);
    else removedSegments.push(segment);
  }
  const removedChars = removedSegments.reduce((sum, segment) => sum + segment.length, 0);
  const oldChars = oldSegments.reduce((sum, segment) => sum + segment.length, 0);
  return {
    removedSegments,
    modifiedSegments,
    removedChars,
    oldChars,
    ratio: oldChars > 0 ? removedChars / oldChars : 0,
    structuredTokensRemoved: [...new Set(structuredTokensRemoved)],
  };
}

// G1: merge testcases by their stable key (name). Untouched testcases survive;
// only an explicit {name, op:'remove'} deletes one.
function mergeTestcasesPatch(existing, patchEntries) {
  if (!Array.isArray(patchEntries)) {
    throw new Error('patch.testcases must be an array of { name, ... } entries');
  }
  const result = Array.isArray(existing) ? existing.map(entry => ({ ...entry })) : [];
  for (const entry of patchEntries) {
    if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string' || entry.name.trim() === '') {
      throw new Error('patch.testcases entries must have a non-empty string name (the stable merge key)');
    }
    const index = result.findIndex(existingEntry => existingEntry.name === entry.name);
    if (entry.op === 'remove') {
      if (index >= 0) result.splice(index, 1);
      continue;
    }
    const next = { ...entry };
    delete next.op;
    if (index >= 0) result[index] = next;
    else result.push(next);
  }
  return result;
}

// G1: merge relationship attributes by name ({ name, description }). Unmentioned
// attributes survive; op:'remove' deletes by name.
function mergeRelationshipAttributesPatch(existing, patchEntries) {
  if (!Array.isArray(patchEntries)) {
    throw new Error('patch.attributes must be an array of { name, ... } entries');
  }
  const result = Array.isArray(existing) ? existing.map(entry => ({ ...entry })) : [];
  for (const entry of patchEntries) {
    if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string' || entry.name.trim() === '') {
      throw new Error('patch.attributes entries must have a non-empty string name');
    }
    const index = result.findIndex(attr => attr.name === entry.name);
    if (entry.op === 'remove') {
      if (index >= 0) result.splice(index, 1);
      continue;
    }
    const next = { name: entry.name };
    for (const field of ['value', 'description', 'content']) {
      if (Object.prototype.hasOwnProperty.call(entry, field)) next[field] = entry[field];
    }
    if (index >= 0) result[index] = next;
    else result.push(next);
  }
  return result;
}

// G1: apply a view membership patch as either a full list (legacy replace) or a
// lossless delta { add, remove }. Returns the resulting list.
function applyViewMembershipPatch(current, patchValue) {
  const base = Array.isArray(current) ? current : [];
  if (Array.isArray(patchValue)) {
    return { list: dedupe(patchValue), explicitRemove: null };
  }
  if (patchValue && typeof patchValue === 'object') {
    const remove = Array.isArray(patchValue.remove) ? patchValue.remove : [];
    const add = Array.isArray(patchValue.add) ? patchValue.add : [];
    const kept = base.filter(id => !remove.includes(id));
    return { list: dedupe([...kept, ...add]), explicitRemove: remove };
  }
  throw new Error('view membership patch must be an array or { add, remove }');
}

function dedupe(entries) {
  const seen = new Set();
  const result = [];
  for (const entry of entries) {
    if (seen.has(entry)) continue;
    seen.add(entry);
    result.push(entry);
  }
  return result;
}

function findById(entries, id) {
  return Array.isArray(entries) ? entries.find(entry => entry && entry.id === id) : undefined;
}

function findView(views, viewId) {
  return Array.isArray(views) ? views.find(view => view && view.view_id === viewId) : undefined;
}

function isAcknowledged(mutation, lossAck) {
  return (Boolean(mutation) && mutation[LOSS_ACK_FIELD] === true)
    || (Boolean(lossAck) && lossAck[LOSS_ACK_FIELD] === true);
}

function hasJustification(mutation, lossAck) {
  const text = (mutation && mutation[LOSS_JUSTIFICATION_FIELD])
    || (lossAck && lossAck[LOSS_JUSTIFICATION_FIELD]);
  return typeof text === 'string' && text.trim() !== '';
}

// G5+enforcement: compute every content reduction a mutation set would cause,
// with per-item acknowledgement state, and whether the set must be blocked.
// `lossAck` is an optional batch-level acknowledgement (applySystemArchitectureMutation
// top level) that counts for every mutation in the set.
function buildLossReport({ baseDocument, mutations, nextDocument, lossAck }) {
  const base = baseDocument || {};
  const next = nextDocument || {};
  const report = {
    blocked: false,
    acknowledged: true,
    reasons: [],
    text: [],
    modifications: [],
    membersRemoved: [],
    testcasesRemoved: [],
    attributesRemoved: [],
    objectsRemoved: [],
  };

  const pushReason = (reason) => {
    report.blocked = true;
    report.acknowledged = false;
    if (!report.reasons.includes(reason)) report.reasons.push(reason);
  };

  const guardText = (mutation, kind, id, field, oldValue, newValue) => {
    const loss = detectTextLoss(oldValue, newValue);
    if (loss.modifiedSegments.length > 0) {
      // Reworded, not dropped: reported for transparency, never blocked.
      report.modifications.push({ kind, id, field, modifiedLines: loss.modifiedSegments.length, sample: loss.modifiedSegments.slice(0, 3) });
    }
    const hasLoss = loss.removedSegments.length > 0 || loss.structuredTokensRemoved.length > 0;
    if (!hasLoss) return;
    // "Major" only when the removed volume is substantial; a large share of a
    // tiny value is not major (avoids forcing justification for short edits).
    const major = loss.removedChars > MAJOR_REMOVED_CHARS
      || (loss.oldChars > MAJOR_REMOVED_CHARS && loss.ratio > MAJOR_REMOVED_RATIO);
    const acknowledged = isAcknowledged(mutation, lossAck) && (!major || hasJustification(mutation, lossAck));
    const item = {
      kind,
      id,
      field,
      removedChars: loss.removedChars,
      removedLines: loss.removedSegments.length,
      structuredTokensRemoved: loss.structuredTokensRemoved,
      ratio: Number(loss.ratio.toFixed(3)),
      major,
      acknowledged,
      removedSample: loss.removedSegments.slice(0, 3),
    };
    report.text.push(item);
    if (!acknowledged) {
      const why = major && !hasJustification(mutation, lossAck)
        ? ' (major loss requires a non-empty lossJustification)'
        : '';
      const structured = loss.structuredTokensRemoved.length > 0
        ? ` [structured tokens removed: ${loss.structuredTokensRemoved.slice(0, 5).join(', ')}]`
        : '';
      pushReason(
        `Unacknowledged text loss: ${kind} '${id}' field '${field}' would remove ${loss.removedChars} char(s) / ${loss.removedSegments.length} line(s)${structured}${why}. `
        + 'Read the current value first, then pass acknowledgeLoss:true (and lossJustification) to confirm an intentional rewrite, or use an additive edit that keeps the prior content.',
      );
    }
  };

  for (const mutation of mutations || []) {
    if (mutation.type === 'updateElement' || mutation.type === 'updateRelationship') {
      const collection = mutation.type === 'updateElement' ? 'elements' : 'relationships';
      const kind = mutation.type === 'updateElement' ? 'element' : 'relationship';
      const baseEntry = findById(base[collection], mutation.id);
      const nextEntry = findById(next[collection], mutation.id);
      if (!baseEntry || !nextEntry) continue;
      for (const field of TEXT_FIELDS_BY_MUTATION[mutation.type]) {
        guardText(mutation, kind, mutation.id, field, baseEntry[field], nextEntry[field]);
      }
      if (mutation.type === 'updateElement' && Array.isArray(baseEntry.testcases)) {
        const nextNames = new Set((nextEntry.testcases || []).map(tc => tc && tc.name));
        for (const tc of baseEntry.testcases) {
          if (tc && tc.name && !nextNames.has(tc.name)) {
            report.testcasesRemoved.push({ id: mutation.id, name: tc.name });
          }
        }
      }
    } else if (mutation.type === 'updateView') {
      const viewId = mutation.view_id || mutation.id;
      const baseView = findView(base.views, viewId);
      const nextView = findView(next.views, viewId);
      if (!baseView || !nextView) continue;
      for (const field of TEXT_FIELDS_BY_MUTATION.updateView) {
        guardText(mutation, 'view', viewId, field, baseView[field], nextView[field]);
      }
      const baseElements = new Set(baseView.included_elements || []);
      const removedElements = [...baseElements].filter(id => !(nextView.included_elements || []).includes(id));
      const baseRelationships = new Set(baseView.included_relationships || []);
      const removedRelationships = [...baseRelationships].filter(id => !(nextView.included_relationships || []).includes(id));
      if (removedElements.length > 0 || removedRelationships.length > 0) {
        // A channel with no removals is trivially covered; a channel with removals
        // is explicit only when patched via the delta { remove } form.
        const elementsExplicit = removedElements.length === 0
          || isExplicitRemovePatch(mutation.patch, 'included_elements');
        const relationshipsExplicit = removedRelationships.length === 0
          || isExplicitRemovePatch(mutation.patch, 'included_relationships');
        const explicit = elementsExplicit && relationshipsExplicit;
        const acknowledged = explicit || isAcknowledged(mutation, lossAck);
        report.membersRemoved.push({
          view_id: viewId,
          elements: removedElements,
          relationships: removedRelationships,
          explicit,
          acknowledged,
        });
        if (!acknowledged) {
          pushReason(
            `Unacknowledged membership removal in view '${viewId}': ${removedElements.length} element(s) and ${removedRelationships.length} relationship(s) would be dropped. `
            + 'Use the delta form included_elements:{remove:[...]} for explicit removal, or pass acknowledgeLoss:true.',
          );
        }
      }
    } else if (mutation.type === 'removeElement' || mutation.type === 'removeRelationship' || mutation.type === 'removeView') {
      const spec = {
        removeElement: { collection: 'elements', id: mutation.id },
        removeRelationship: { collection: 'relationships', id: mutation.id },
        removeView: { collection: 'views', id: mutation.view_id },
      }[mutation.type];
      const id = spec.id;
      const baseEntry = mutation.type === 'removeView'
        ? findView(base.views, id)
        : findById(base[spec.collection], id);
      const stillPresent = mutation.type === 'removeView'
        ? Boolean(findView(next.views, id))
        : Boolean(findById(next[spec.collection], id));
      if (!baseEntry || stillPresent) continue;
      const acknowledged = isAcknowledged(mutation, lossAck);
      report.objectsRemoved.push({
        kind: mutation.type.replace(/^remove/, '').toLowerCase(),
        id,
        name: baseEntry.name || baseEntry.view_name,
        acknowledged,
      });
      if (!acknowledged) {
        pushReason(
          `Unacknowledged destructive removal: ${mutation.type} '${id}' ('${baseEntry.name || baseEntry.view_name}') deletes the object permanently. `
          + 'Pass acknowledgeLoss:true (a full tombstone snapshot is recorded for recovery).',
        );
      }
    }
  }

  return report;
}

function isExplicitRemovePatch(patch, field) {
  if (!patch || !Object.prototype.hasOwnProperty.call(patch, field)) return false;
  const value = patch[field];
  return Boolean(value) && !Array.isArray(value) && typeof value === 'object' && Array.isArray(value.remove);
}

// G3: append full removed objects to an NDJSON tombstone ledger. Each append is a
// single O(1) line write (no read/rewrite of prior content). When the active file
// exceeds the size cap (~5k entries) it is rotated aside (rename, O(1)) so the
// active file and its git diff stay bounded.
const TOMBSTONE_ACTIVE_BASENAME = 'SystemArchitecture.tombstones.ndjson';
const TOMBSTONE_ROTATE_BYTES = 2 * 1024 * 1024;

function tombstoneFilePath(graphAbsolutePath) {
  return path.join(path.dirname(graphAbsolutePath), TOMBSTONE_ACTIVE_BASENAME);
}

function appendTombstones(graphAbsolutePath, entries, options = {}) {
  const file = tombstoneFilePath(graphAbsolutePath);
  const rotateBytes = Number.isFinite(options.rotateBytes) ? options.rotateBytes : TOMBSTONE_ROTATE_BYTES;
  const list = Array.isArray(entries) ? entries : [];
  if (list.length === 0) return { path: file, count: 0, rotatedTo: null };
  let rotatedTo = null;
  try {
    if (rotateBytes > 0 && fs.statSync(file).size >= rotateBytes) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      rotatedTo = path.join(path.dirname(file), `SystemArchitecture.tombstones.${stamp}.ndjson`);
      fs.renameSync(file, rotatedTo);
    }
  } catch {
    // No active file yet (first append) — nothing to rotate.
  }
  const at = new Date().toISOString();
  const lines = list.map(entry => JSON.stringify({
    at,
    op: entry.op || ('remove' + entry.kind),
    kind: entry.kind,
    id: entry.id,
    object: entry.object,
  }));
  fs.appendFileSync(file, `${lines.join('\n')}\n`, 'utf8');
  return { path: file, count: list.length, rotatedTo };
}

// Read back the NDJSON tombstone ledger (recovery / audit). Malformed lines are
// skipped rather than throwing, so a partially written tail never blocks reads.
function readTombstones(file) {
  try {
    return fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter(line => line.trim() !== '')
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Collect the full base objects for every global removal in a mutation set.
function collectRemovedObjects(baseDocument, mutations, nextDocument) {
  const removed = [];
  for (const mutation of mutations || []) {
    if (mutation.type === 'removeElement') {
      const obj = findById((baseDocument || {}).elements, mutation.id);
      if (obj && !findById((nextDocument || {}).elements, mutation.id)) removed.push({ op: mutation.type, kind: 'element', id: mutation.id, object: obj });
    } else if (mutation.type === 'removeRelationship') {
      const obj = findById((baseDocument || {}).relationships, mutation.id);
      if (obj && !findById((nextDocument || {}).relationships, mutation.id)) removed.push({ op: mutation.type, kind: 'relationship', id: mutation.id, object: obj });
    } else if (mutation.type === 'removeView') {
      const obj = findView((baseDocument || {}).views, mutation.view_id);
      if (obj && !findView((nextDocument || {}).views, mutation.view_id)) removed.push({ op: mutation.type, kind: 'view', id: mutation.view_id, object: obj });
    }
  }
  return removed;
}

module.exports = {
  LOSS_ACK_FIELD,
  LOSS_JUSTIFICATION_FIELD,
  MAJOR_REMOVED_CHARS,
  MAJOR_REMOVED_RATIO,
  TEXT_FIELDS_BY_MUTATION,
  normalizeSegments,
  detectTextLoss,
  mergeTestcasesPatch,
  mergeRelationshipAttributesPatch,
  applyViewMembershipPatch,
  buildLossReport,
  appendTombstones,
  readTombstones,
  tombstoneFilePath,
  TOMBSTONE_ACTIVE_BASENAME,
  TOMBSTONE_ROTATE_BYTES,
  collectRemovedObjects,
};
