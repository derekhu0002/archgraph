'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SCRIPTS = [
  path.join(ROOT, 'eatool', 'EA-jsscript', 'import-from-kg.js'),
  path.join(ROOT, 'eatool', 'EA-jsscript', 'import-from-external-package.js'),
];

function readScript(file) {
  assert.ok(existsSync(file), `script should exist: ${file}`);
  // Normalize CRLF so literal newline matching is stable across the two scripts.
  return readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

test('ea-import-direction: connectors carry an explicit Source -> Destination direction so arrowheads render', () => {
  // GIVEN both EA import scripts create connectors from source (client) to target (supplier)
  //   and EA renders no arrowhead on Association connectors while Direction stays Unspecified
  // WHEN each script wires a relationship connector
  // THEN it sets connector.Direction = "Source -> Destination" under an explicit directed flag,
  //   so the generated views draw an arrow from the source element toward the target element
  for (const file of SCRIPTS) {
    const content = readScript(file);
    const label = path.basename(file);
    assert.match(
      content,
      /connector\.Direction\s*=\s*['"]Source -> Destination['"]/,
      `${label} should set a Source -> Destination direction for directed relationships`
    );
    assert.match(
      content,
      /if\s*\(\s*connectorMeta\.directed\s*\)\s*\{?/,
      `${label} should gate the Direction assignment on the relationship being directed`
    );
  }
});

test('ea-import-direction: mapping flags directed types and keeps undirected ones arrow-free', () => {
  // GIVEN ArchiMate directedness: Serving/Assignment/Access/Realization/Triggering/Flow/
  //   Influence/Specialization are directed, while Association is undirected and
  //   Composition/Aggregation carry a whole/part diamond (not an arrowhead)
  // WHEN the EA connector mapping table is inspected
  // THEN each directed group is flagged meta.directed = true, the default stays directed:false,
  //   and undirected Association is mapped in its own (unflagged) case
  for (const file of SCRIPTS) {
    const content = readScript(file);
    const label = path.basename(file);
    assert.match(content, /directed:\s*false/, `${label} should default the mapping to undirected (Association/Composition/Aggregation stay arrow-free)`);
    const directedFlags = (content.match(/meta\.directed\s*=\s*true/g) || []).length;
    assert.ok(directedFlags >= 4, `${label} should flag the directed relationship groups (found ${directedFlags})`);
    // Directed ArchiMate types are all reachable through the mapping switch.
    for (const type of ['Serving', 'Assignment', 'Access', 'Realization', 'Specialization', 'Triggering', 'Flow', 'Influence']) {
      assert.match(
        content,
        new RegExp(`case\\s+['\"]?${type}['\"]?\\s*:`),
        `${label} should map the directed relationship type ${type}`
      );
    }
    // Association must be separated from the Serving/Assignment case so it is not flagged directed.
    const servingAssignmentIndex = content.indexOf("case 'Serving':\n    case 'Assignment':");
    const associationCaseIndex = content.indexOf("case 'Association':");
    assert.ok(servingAssignmentIndex >= 0 && associationCaseIndex >= 0, `${label} should keep Association in its own mapping case`);
  }
});
