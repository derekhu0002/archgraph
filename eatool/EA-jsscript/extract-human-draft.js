!INC Local Scripts.EAConstants-JScript
!INC UTILITY.JSON-Parser

/*
 * Script Name: Extract Human Draft (extract-human-draft)
 * Purpose: Runs INSIDE Sparx EA and extracts the human's DRAFT from the currently-open
 *          model as a semantic-diff proposal set (this replaced the removed node tool
 *          argo/scripts/ea-human-diff.js; it is now the only implementation):
 *            - baseline = the canonical graph design/KG/SystemArchitecture.json (source of
 *              truth; the committed .qea is its projection, so live-EA vs canonical is
 *              semantically equivalent to the node tool's base=committed.qea vs work=live)
 *            - work = the EA *visible object model* of the open model (t_object/t_connector/
 *              t_diagram/t_diagramobjects anchored by schema_id / schema_view_id), NEVER
 *              kg_sync_meta (human edits never touch the mirror)
 *            - pure geometry (t_diagramobjects coords) never becomes a canonical proposal,
 *              only counted (layoutOnly)
 *          Then writes results/human-draft.json (machine proposal set) + results/human-draft.md
 *          (human-readable summary). The script ONLY extracts the draft — it never writes back
 *          to the graph; applying the proposal to the canonical graph is done by whoever runs it.
 *
 * Why in-EA: the node tool needs the model closed + two .qea files (base=committed, work=live).
 * A script in EA sees the live model directly and always has the canonical JSON on disk, so the
 * human needs only: make EA edits -> save -> run this script -> hand the proposal out.
 *
 * Run interactively: Scripts -> Run (EA Script window). No current diagram needed.
 * Headless (bootstrap.js drives it): set EA_HEADLESS_GRAPH (baseline json) + EA_HEADLESS_OUTPUT
 * (output stem). When absent: baseline = <model dir>\design\KG\SystemArchitecture.json, output
 * stem = <model dir>\results\human-draft.
 *
 * JScript 5.8 compatible: no Map/Set/Array.prototype.find/includes/Object.values/arrow fns.
 */

if (typeof JSON == 'undefined') {
	JSON = { parse: function (t) { return eval('(' + t + ')'); } };
}

// ---------------------------------------------------------------------------
// Generic text / XML / EA SQLQuery helpers
// ---------------------------------------------------------------------------
function trimString(s) {
	if (s == null || typeof s == 'undefined') { return ''; }
	return ('' + s).replace(/^\s+|\s+$/g, '');
}

function normText(s) {
	return trimString(s);
}

function decodeXml(s) {
	var t = '' + (s == null ? '' : s);
	t = t.replace(/&lt;/g, '<');
	t = t.replace(/&gt;/g, '>');
	t = t.replace(/&quot;/g, '"');
	t = t.replace(/&apos;/g, "'");
	t = t.replace(/&#x([0-9a-fA-F]+);/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); });
	t = t.replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(parseInt(n, 10)); });
	t = t.replace(/&amp;/g, '&');
	return t;
}

// Parse EA Repository.SQLQuery XML into an array of row objects keyed by column name.
// EA returns column tags with the table's physical column-name case (e.g. t_connectortag
// is VALUE/NOTES, t_objectproperties is Value/Notes). Normalize every key to lower case so
// reads are case-insensitive — a case mismatch silently yields undefined, which corrupted
// schema_id / archimate_relationship_type reads on t_connectortag.
function eaRows(sql) {
	var out = [];
	var xml = '';
	try { xml = '' + Repository.SQLQuery(sql); } catch (e) { return out; }
	var rowRe = /<Row>([\s\S]*?)<\/Row>/gi;
	var rm;
	while ((rm = rowRe.exec(xml)) != null) {
		var rec = {};
		var colRe = /<([A-Za-z_][A-Za-z0-9_]*)>([\s\S]*?)<\/\1>/gi;
		var cm;
		while ((cm = colRe.exec(rm[1])) != null) {
			// 'default' is a JScript reserved word; it cannot be used as a property name via
			// dotted access (.default) in the ES3 engine. Map the column to a safe key.
			var key = cm[1].toLowerCase();
			if (key === 'default') { key = 'defaultval'; }
			rec[key] = decodeXml(cm[2]);
		}
		out.push(rec);
	}
	return out;
}

function parseStyleToken(styleEx, key) {
	var text = String(styleEx === null || styleEx === undefined ? '' : styleEx);
	var re = new RegExp('(^|;|\\s)' + key + '=([^;]*)', 'i');
	var m = re.exec(text);
	return m ? m[2] : '';
}

function readTextUtf8(filePath) {
	try {
		var fso = new ActiveXObject('Scripting.FileSystemObject');
		if (!fso.FileExists(filePath)) { return ''; }
		var stream = new ActiveXObject('ADODB.Stream');
		stream.Type = 2;
		stream.Charset = 'utf-8';
		stream.Open();
		stream.LoadFromFile(filePath);
		var text = stream.ReadText();
		stream.Close();
		return text.replace(/^\uFEFF/, '');
	} catch (e) {
		return '';
	}
}

function writeTextUtf8(filePath, text) {
	// ADODB.Stream type 2 (text) with utf-8; write WITHOUT BOM by writing the string twice
	// (the first write emits a BOM which is then skipped). Simplest reliable UTF-8-no-BOM:
	// write a zero-length UTF-16 mode then switch; here we use a script trick that works on
	// WSH: stream.Charset='utf-8', write text, SaveToFile. BOM may appear; downstream
	// consumers strip it. We additionally attempt a BOM-less write by writing an empty first.
	var fso = new ActiveXObject('Scripting.FileSystemObject');
	var dir = fso.GetParentFolderName(filePath);
	if (!fso.FolderExists(dir)) {
		// create nested dirs
		var parts = dir.split('\\');
		var cur = parts[0];
		for (var i = 1; i < parts.length; i++) {
			cur += '\\' + parts[i];
			if (!fso.FolderExists(cur)) { fso.CreateFolder(cur); }
		}
	}
	var stream = new ActiveXObject('ADODB.Stream');
	stream.Type = 2;
	stream.Charset = 'utf-8';
	stream.Open();
	stream.WriteText(text);
	stream.SaveToFile(filePath, 2); // 2 = overwrite
	stream.Close();
}

// ---------------------------------------------------------------------------
// Model path / repo root resolution
// ---------------------------------------------------------------------------
function getConnectionProperty(conn, keyName) {
	if (conn == null || conn == '') { return ''; }
	var pattern = new RegExp('(?:^|;)\\s*' + keyName + '\\s*=\\s*([^;]+)', 'i');
	var m = ('' + conn).match(pattern);
	if (m && m.length > 1) { return trimString(m[1]); }
	return '';
}

function stripWrappedQuotes(s) {
	var v = trimString(s);
	if (v.length >= 2) {
		var first = v.charAt(0);
		var last = v.charAt(v.length - 1);
		if ((first == '"' && last == '"') || (first == "'" && last == "'")) {
			return v.substring(1, v.length - 1);
		}
	}
	return v;
}

function resolveModelFilePath() {
	var conn = '';
	try { conn = '' + Repository.ConnectionString; } catch (e) { return ''; }
	if (conn == '') { return ''; }
	var dataSource = getConnectionProperty(conn, 'Data Source');
	if (dataSource == '') { dataSource = getConnectionProperty(conn, 'DataSource'); }
	if (dataSource == '') { dataSource = getConnectionProperty(conn, 'DBQ'); }
	if (dataSource != '') { return stripWrappedQuotes(dataSource); }
	var direct = stripWrappedQuotes(conn);
	if (/^[A-Za-z]:\\/.test(direct) || /^\\\\/.test(direct)) { return direct; }
	return '';
}

function repoRoot() {
	var mf = resolveModelFilePath();
	if (mf == '') { return ''; }
	try {
		var fso = new ActiveXObject('Scripting.FileSystemObject');
		return fso.GetParentFolderName(mf);
	} catch (e) { return ''; }
}

// ---------------------------------------------------------------------------
// Baseline snapshot (from canonical JSON — source of truth)
// ---------------------------------------------------------------------------
function cloneAttr(a) {
	if (!a) { return null; }
	return { name: a.name || '', value: a.value || '', description: a.description || '', content: a.content || '' };
}

function cloneTestcase(t) {
	if (!t) { return null; }
	return {
		name: t.name || '',
		description: t.description || '',
		type: t.type || '',
		Input: t.Input || '',
		acceptanceCriteria: t.acceptanceCriteria || ''
	};
}

// Stable per-attribute comparison key: normalized name+value (a human editing an EA
// attribute value changes the value; a rename changes the name).
function attrKey(attr) {
	return normText(attr.name) + '\u0001' + normText(attr.value);
}

// Count a human's attribute diff as add/update/remove by comparing baselines against EA.
function diffAttrs(baseList, workList) {
	var add = [];
	var update = [];
	var remove = [];
	var baseByKey = {};
	var workByKey = {};
	var i;
	for (i = 0; i < baseList.length; i++) { baseByKey[attrKey(baseList[i])] = baseList[i]; }
	for (i = 0; i < workList.length; i++) { workByKey[attrKey(workList[i])] = workList[i]; }
	// present in work but not baseline -> added
	for (var wk in workByKey) {
		if (workByKey.hasOwnProperty(wk)) {
			if (!baseByKey.hasOwnProperty(wk)) { add.push(workByKey[wk]); }
		}
	}
	// present in baseline but not work -> removed
	for (var bk in baseByKey) {
		if (baseByKey.hasOwnProperty(bk)) {
			if (!workByKey.hasOwnProperty(bk)) { remove.push(baseByKey[bk]); }
		}
	}
	// same key -> compare description/content -> updated
	for (var uk in baseByKey) {
		if (baseByKey.hasOwnProperty(uk) && workByKey.hasOwnProperty(uk)) {
			var bs = baseByKey[uk];
			var ws = workByKey[uk];
			if (normText(bs.description) !== normText(ws.description) || normText(bs.content) !== normText(ws.content)) {
				update.push(ws);
			}
		}
	}
	var changed = add.length > 0 || remove.length > 0 || update.length > 0;
	return { changed: changed, add: add, update: update, remove: remove };
}

// Testcase diff keyed on testcase name (unique per element); compare description/criteria.
function diffTestcases(baseList, workList) {
	var add = [];
	var remove = [];
	var update = [];
	var baseByName = {};
	var workByName = {};
	var i;
	for (i = 0; i < baseList.length; i++) { if (baseList[i] && baseList[i].name) { baseByName[normText(baseList[i].name)] = baseList[i]; } }
	for (i = 0; i < workList.length; i++) { if (workList[i] && workList[i].name) { workByName[normText(workList[i].name)] = workList[i]; } }
	for (var wn in workByName) {
		if (workByName.hasOwnProperty(wn) && !baseByName.hasOwnProperty(wn)) { add.push(workByName[wn]); }
	}
	for (var bn in baseByName) {
		if (baseByName.hasOwnProperty(bn) && !workByName.hasOwnProperty(bn)) { remove.push(baseByName[bn]); }
	}
	for (var un in baseByName) {
		if (baseByName.hasOwnProperty(un) && workByName.hasOwnProperty(un)) {
			var b = baseByName[un];
			var w = workByName[un];
			if (normText(b.description) !== normText(w.description) || normText(b.acceptanceCriteria) !== normText(w.acceptanceCriteria) || normText(b.Input) !== normText(w.Input)) {
				update.push(w);
			}
		}
	}
	var changed = add.length > 0 || remove.length > 0 || update.length > 0;
	return { changed: changed, add: add, update: update, remove: remove };
}

function readCanonical(graphPath) {
	var text = readTextUtf8(graphPath);
	if (text == '') { return null; }
	var g = JSON.parse(text);
	var base = { elementById: {}, relById: {}, viewById: {} };
	for (var i = 0; i < (g.elements || []).length; i++) {
		var e = g.elements[i];
		if (e && e.id !== undefined && e.id !== null) {
		base.elementById[String(e.id)] = {
			name: e.name || '',
			description: e.description || '',
			status: e.status || '',
			type: e.type || '',
			attributes: arrayMap(e.attributes || [], cloneAttr),
			testcases: arrayMap(e.testcases || [], cloneTestcase)
		};
		}
	}
	for (var j = 0; j < (g.relationships || []).length; j++) {
		var r = g.relationships[j];
		if (r && r.id !== undefined && r.id !== null) {
		base.relById[String(r.id)] = {
			name: r.name || '',
			description: r.description || '',
			type: r.type || '',
			sourceId: String(r.source_id),
			targetId: String(r.target_id),
			attributes: arrayMap(r.attributes || [], cloneAttr)
		};
		}
	}
	for (var k = 0; k < (g.views || []).length; k++) {
		var v = g.views[k];
		if (v && v.view_id !== undefined && v.view_id !== null) {
			base.viewById[String(v.view_id)] = {
				view_name: v.view_name || '',
				description: v.description || '',
				included_elements: arrayMap(v.included_elements || [], function (x) { return String(x); }),
				included_relationships: arrayMap(v.included_relationships || [], function (x) { return String(x); })
			};
		}
	}
	return base;
}

// ---------------------------------------------------------------------------
// Work snapshot (from the live EA visible object model, anchored via schema_id)
// ---------------------------------------------------------------------------
function readWork(knownViews) {
	var syncPackageId = 0;
	var roots = eaRows('SELECT Package_ID FROM t_package WHERE Parent_ID=0 ORDER BY Package_ID LIMIT 1');
	if (roots.length > 0) {
		var pkgs = eaRows("SELECT Package_ID FROM t_package WHERE Parent_ID=" + roots[0].package_id + " AND Name='ArchGraph Sync' LIMIT 1");
		if (pkgs.length > 0) { syncPackageId = parseInt(pkgs[0].package_id, 10) || 0; }
	}

	// Match EA diagrams to canonical views. Preferred anchor: the schema_view_id StyleEx token
	// the projector writes. EA rewrites StyleEx and drops unknown tokens, so also match by the
	// diagram Name == canonical view_name (the projector names each diagram after the view).
	// A diagram with neither is a human-drawn / user-added view.
	var knownViewNames = {};
	var viewsCatalog = knownViews || {};
	for (var bvId in viewsCatalog) { if (viewsCatalog.hasOwnProperty(bvId)) { knownViewNames[normText(viewsCatalog[bvId].view_name)] = bvId; } }

	var diagramsByView = {};
	var viewByDiagram = {};
	var extraDiagrams = [];
	var diags = eaRows('SELECT Diagram_ID, Package_ID, Name, Notes, StyleEx, ea_guid FROM t_diagram');
	for (var i = 0; i < diags.length; i++) {
		var d = diags[i];
		var diagramId = parseInt(d.diagram_id, 10);
		var diagName = String(d.name || '');
		var ref = {
			diagramId: diagramId,
			view_name: diagName,
			description: String(d.notes === null || d.notes === undefined ? '' : d.notes),
			eaGuid: String(d.ea_guid || '')
		};
		var viewId = parseStyleToken(d.styleex, 'schema_view_id');
		if (viewId) {
			diagramsByView[viewId] = ref;
			viewByDiagram[diagramId] = viewId;
		} else if (knownViewNames.hasOwnProperty(normText(diagName))) {
			var matchedId = knownViewNames[normText(diagName)];
			diagramsByView[matchedId] = ref;
			viewByDiagram[diagramId] = matchedId;
		} else {
			// no schema_view_id anchor and Name not in canonical -> human-drawn / user-added view
			extraDiagrams.push(ref);
		}
	}

	var elemTags = {};
	var props = eaRows("SELECT Object_ID, Property, Value FROM t_objectproperties WHERE Property IN ('schema_id','archimate_type')");
	for (var p = 0; p < props.length; p++) {
		var oid = parseInt(props[p].object_id, 10);
		if (!elemTags[oid]) { elemTags[oid] = {}; }
		var t = elemTags[oid];
		if (props[p].property == 'schema_id') { t.schemaId = String(props[p].value); }
		if (props[p].property == 'archimate_type') { t.archimateType = String(props[p].value); }
	}

	var elementBySchema = {};
	var elementByGuid = {};
	var elems = eaRows('SELECT Object_ID, Alias, ea_guid, Object_Type, Stereotype, Name, Note, Status, Package_ID FROM t_object');

	// element attributes (t_attribute) + testcases (t_objecttests), mapped by Object_ID
	var attrsByObject = {};
	var arows = eaRows('SELECT ID, Object_ID, Name, "Default", Notes, Pos FROM t_attribute');
	for (var ar = 0; ar < arows.length; ar++) {
		var attrObjId = parseInt(arows[ar].object_id, 10);
		if (!attrsByObject[attrObjId]) { attrsByObject[attrObjId] = []; }
		attrsByObject[attrObjId].push({ name: String(arows[ar].name || ''), value: String(arows[ar].defaultval === null || arows[ar].defaultval === undefined ? '' : arows[ar].defaultval), description: String(arows[ar].notes === null || arows[ar].notes === undefined ? '' : arows[ar].notes) });
	}
	var testsByObject = {};
	var trows = eaRows('SELECT Object_ID, Test, Notes, InputData, AcceptanceCriteria FROM t_objecttests');
	for (var tr = 0; tr < trows.length; tr++) {
		var testObjId = parseInt(trows[tr].object_id, 10);
		if (!testsByObject[testObjId]) { testsByObject[testObjId] = []; }
		testsByObject[testObjId].push({ name: String(trows[tr].test || ''), description: String(trows[tr].notes || ''), Input: String(trows[tr].inputdata || ''), acceptanceCriteria: String(trows[tr].acceptancecriteria || '') });
	}

	for (var e = 0; e < elems.length; e++) {
		var x = elems[e];
		var rec = {
			objectId: parseInt(x.object_id, 10),
			alias: x.alias || '',
			eaGuid: String(x.ea_guid || ''),
			objectType: String(x.object_type || ''),
			stereotype: String(x.stereotype || ''),
			name: String(x.name || ''),
			description: String(x.note === null || x.note === undefined ? '' : x.note),
			status: String(x.status || ''),
			packageId: parseInt(x.package_id || 0, 10),
			attributes: attrsByObject[parseInt(x.object_id, 10)] || [],
			testcases: testsByObject[parseInt(x.object_id, 10)] || []
		};
		var tg = elemTags[rec.objectId];
		if (tg && tg.schemaId) {
			rec.schemaId = tg.schemaId;
			rec.archimateType = tg.archimateType || '';
			elementBySchema[rec.schemaId] = rec;
		}
		if (rec.eaGuid) { elementByGuid[rec.eaGuid] = rec; }
	}

	var relTags = {};
	var rprops = eaRows("SELECT ElementID, Property, Value FROM t_connectortag WHERE Property IN ('schema_id','archimate_relationship_type','relationship_attributes_json')");
	for (var q = 0; q < rprops.length; q++) {
		var cid = parseInt(rprops[q].elementid, 10);
		if (!relTags[cid]) { relTags[cid] = {}; }
		var rt = relTags[cid];
		if (rprops[q].property == 'schema_id') { rt.schemaId = String(rprops[q].value); }
		if (rprops[q].property == 'archimate_relationship_type') { rt.archimateType = String(rprops[q].value); }
		if (rprops[q].property == 'relationship_attributes_json') { rt.attrsJson = String(rprops[q].value); }
	}

	function parseRelAttrs(rt) {
		var out = [];
		if (rt && rt.attrsJson) {
			try {
				var parsed = JSON.parse(rt.attrsJson);
				for (var i = 0; i < (Array.isArray(parsed) ? parsed.length : 0); i++) { out.push(cloneAttr(parsed[i])); }
			} catch (e) { /* ignore malformed tag */ }
		}
		return out;
	}

	var relBySchema = {};
	var relByGuid = {};
	var conns = eaRows('SELECT Connector_ID, ea_guid, Name, Connector_Type, Stereotype, Notes, Direction, Start_Object_ID, End_Object_ID FROM t_connector');
	for (var c = 0; c < conns.length; c++) {
		var y = conns[c];
		var rrec = {
			connectorId: parseInt(y.connector_id, 10),
			eaGuid: String(y.ea_guid || ''),
			name: String(y.name || ''),
			connectorType: String(y.connector_type || ''),
			stereotype: String(y.stereotype || ''),
			description: String(y.notes === null || y.notes === undefined ? '' : y.notes),
			direction: String(y.direction || ''),
			sourceObjectId: parseInt(y.start_object_id || 0, 10),
			targetObjectId: parseInt(y.end_object_id || 0, 10),
			attributes: parseRelAttrs(relTags[parseInt(y.connector_id, 10)])
		};
		var rct = relTags[rrec.connectorId];
		if (rct && rct.schemaId) {
			rrec.schemaId = rct.schemaId;
			rrec.archimateType = rct.archimateType || '';
			relBySchema[rrec.schemaId] = rrec;
		}
		if (rrec.eaGuid) { relByGuid[rrec.eaGuid] = rrec; }
	}

	var placements = {};
	var objs = eaRows('SELECT Diagram_ID, Object_ID, Sequence, RectLeft, RectTop, RectRight, RectBottom FROM t_diagramobjects');
	for (var o = 0; o < objs.length; o++) {
		var od = parseInt(objs[o].diagram_id, 10);
		if (!placements[od]) { placements[od] = {}; }
		placements[od][parseInt(objs[o].object_id, 10)] = {
			left: parseInt(objs[o].rectleft || 0, 10),
			top: parseInt(objs[o].recttop || 0, 10),
			right: parseInt(objs[o].rectright || 0, 10),
			bottom: parseInt(objs[o].rectbottom || 0, 10)
		};
	}

	return {
		modelPath: resolveModelFilePath(),
		syncPackageId: syncPackageId,
		diagramsByView: diagramsByView,
		viewByDiagram: viewByDiagram,
		extraDiagrams: extraDiagrams,
		elementBySchema: elementBySchema,
		elementByGuid: elementByGuid,
		relBySchema: relBySchema,
		relByGuid: relByGuid,
		placements: placements
	};
}

// ---------------------------------------------------------------------------
// Semantic helpers
// ---------------------------------------------------------------------------
function elementCanonicalContext(work, rec) {
	if (rec.schemaId) { return true; }
	if (rec.packageId === work.syncPackageId) { return true; }
	for (var diagramId in work.placements) {
		if (work.placements.hasOwnProperty(diagramId) && work.viewByDiagram[parseInt(diagramId, 10)] && work.placements[diagramId].hasOwnProperty(rec.objectId)) {
			return true;
		}
	}
	return false;
}

function placedViewIds(work, objectId) {
	var out = [];
	for (var diagramId in work.placements) {
		if (work.placements.hasOwnProperty(diagramId)) {
			var viewId = work.viewByDiagram[parseInt(diagramId, 10)];
			if (viewId && work.placements[diagramId].hasOwnProperty(objectId)) { out.push(viewId); }
		}
	}
	return out;
}

function elemByObjectId(work, objectId) {
	for (var guid in work.elementByGuid) {
		if (work.elementByGuid.hasOwnProperty(guid)) {
			var e = work.elementByGuid[guid];
			if (e.objectId === objectId) { return e; }
		}
	}
	return null;
}

function guidOfObject(work, objectId) {
	var e = elemByObjectId(work, objectId);
	return e ? e.eaGuid : '';
}

function schemaOfObject(work, objectId) {
	for (var s in work.elementBySchema) {
		if (work.elementBySchema.hasOwnProperty(s)) {
			var e = work.elementBySchema[s];
			if (e.objectId === objectId) { return e.schemaId; }
		}
	}
	for (var g in work.elementByGuid) {
		if (work.elementByGuid.hasOwnProperty(g)) {
			var e2 = work.elementByGuid[g];
			if (e2.objectId === objectId && !e2.schemaId) { return { newGuid: e2.eaGuid }; }
		}
	}
	return null;
}

// Find a connector (in the full relByGuid set) whose source/target objects match the given
// object ids. Used to detect an anchor-drifted relationship: it still EXISTS in EA but lost
// its schema_id tag, so it must NOT be reported as a deletion.
function connectorByEndpoints(work, srcObjectId, tgtObjectId) {
	var match = null;
	for (var g in work.relByGuid) {
		if (!work.relByGuid.hasOwnProperty(g)) { continue; }
		var r = work.relByGuid[g];
		if (r.sourceObjectId === srcObjectId && r.targetObjectId === tgtObjectId) {
			if (!match) { match = r; }
		}
	}
	return match;
}

function arrayContains(arr, v) {
	for (var i = 0; i < arr.length; i++) { if (arr[i] === v) { return true; } }
	return false;
}

// ES3-safe array map (JScript 5.8 has no Array#map/filter).
function arrayMap(arr, fn) {
	var out = [];
	for (var i = 0; i < arr.length; i++) { out[out.length] = fn(arr[i], i); }
	return out;
}

function arrayNonEmpty(arr) {
	var out = [];
	for (var i = 0; i < arr.length; i++) {
		if (arr[i]) { out[out.length] = arr[i]; }
	}
	return out;
}

// Human-readable one-line summary of an attribute list (comma-separated name:value).
function summarizeAttrs(list) {
	var parts = [];
	for (var i = 0; i < (list || []).length; i++) {
		var a = list[i];
		var label = a.name || '(unnamed)';
		if (a.value) { label += '=' + String(a.value).slice(0, 40); }
		parts.push(label);
	}
	return parts.join(', ');
}

function summarizeTestcases(list) {
	var names = [];
	for (var i = 0; i < (list || []).length; i++) {
		if (list[i] && list[i].name) { names.push(list[i].name); }
	}
	return names.join(', ');
}

// One proposal per line, compact (no pretty-print) — keeps the Markdown body small while
// staying machine-readable. Uses JSON.stringify (provided by the JSON-Parser include / shim).
function compactJson(proposals) {
	var out = [];
	for (var i = 0; i < (proposals || []).length; i++) {
		out.push(JSON.stringify(proposals[i]));
	}
	return out.join('\n');
}

// ---------------------------------------------------------------------------
// Semantic diff: baseline (canonical) vs work (live EA visible object model)
// ---------------------------------------------------------------------------
function semanticDiff(base, work) {
	var proposals = [];
	var summary = {
		addElement: 0, updateElement: 0, removeElement: 0,
		addRelationship: 0, updateRelationship: 0, removeRelationship: 0,
		addView: 0, updateView: 0, removeView: 0,
		layoutOnly: 0, outOfScopeNew: 0, removedUnanchored: 0, orphanAnchored: 0
	};
	function push(p) { proposals.push(p); summary[p.op] = (summary[p.op] || 0) + 1; }

	// --- geometry-only counting (never a proposal) -------------------------
	for (var diagramId in work.placements) {
		if (!work.placements.hasOwnProperty(diagramId)) { continue; }
		var vId = work.viewByDiagram[parseInt(diagramId, 10)];
		if (!vId) { continue; }
		var members = work.placements[diagramId];
		for (var oid in members) {
			if (members.hasOwnProperty(oid)) { summary.layoutOnly++; }
		}
	}

	// --- elements: anchored content / removal / addition --------------------
	var baseElementIds = [];
	for (var eid in base.elementById) { if (base.elementById.hasOwnProperty(eid)) { baseElementIds.push(eid); } }

	for (var b = 0; b < baseElementIds.length; b++) {
		var schemaId = baseElementIds[b];
		var baseRec = base.elementById[schemaId];
		var workRec = work.elementBySchema[schemaId];
		if (!workRec) {
			// anchored element removed from the model -> removeElement
			push({ op: 'removeElement', kind: 'element', id: schemaId, sourceEa: {} });
			continue;
		}
		var fields = {};
		if (normText(baseRec.name) !== normText(workRec.name)) { fields.name = workRec.name; }
		if (normText(baseRec.description) !== normText(workRec.description)) { fields.description = workRec.description; }
		// NOTE: no top-level status field — the canonical schema element has no `.status`
		// property; an element's state lives in attributes[].name=='status'. Comparing EA's
		// t_object.Status (default 'Proposed') against a nonexistent canonical top-level status
		// produced a spurious updateElement {status:'Proposed'} for every element. State changes
		// are captured via the attributes diff below.
		if (normText(baseRec.type) !== normText(workRec.archimateType)) { fields.type = workRec.archimateType; }
		var eaAttrDiff = diffAttrs(baseRec.attributes || [], workRec.attributes || []);
		if (eaAttrDiff.changed) { fields.attributes = workRec.attributes; }
		var tcDiff = diffTestcases(baseRec.testcases || [], workRec.testcases || []);
		if (tcDiff.changed) { fields.testcases = workRec.testcases; }
		if (ObjectKeysCount(fields) > 0) {
			push({ op: 'updateElement', kind: 'element', id: schemaId, fields: fields, sourceEa: { guid: workRec.eaGuid } });
		}
	}

	// anchored id present only in work -> orphan (agent reconciles)
	var orphanCount = 0;
	for (var ws in work.elementBySchema) {
		if (work.elementBySchema.hasOwnProperty(ws) && !base.elementById.hasOwnProperty(ws)) { orphanCount++; }
	}
	summary.orphanAnchored = orphanCount;

	// unanchored NEW elements in work (human drew fresh boxes)
	for (var g in work.elementByGuid) {
		if (!work.elementByGuid.hasOwnProperty(g)) { continue; }
		var recU = work.elementByGuid[g];
		if (recU.schemaId) { continue; }
		if (!elementCanonicalContext(work, recU)) { summary.outOfScopeNew++; continue; }
		var vIds = placedViewIds(work, recU.objectId);
		push({
			op: 'addElement', kind: 'element', id: null,
			proposed: {
				name: recU.name,
				description: recU.description === '' ? undefined : recU.description,
				eaType: { objectType: recU.objectType, stereotype: recU.stereotype },
				viewIds: vIds.length > 0 ? vIds : undefined,
				attributes: recU.attributes.length > 0 ? recU.attributes : undefined
			},
			sourceEa: { guid: g, objectId: recU.objectId }
		});
	}

	// --- relationships ------------------------------------------------------
	var baseRelIds = [];
	for (var rid in base.relById) { if (base.relById.hasOwnProperty(rid)) { baseRelIds.push(rid); } }
	// connectors that were matched as an anchor-drift of an existing canonical relationship —
	// they must NOT be double-reported as brand-new addRelationship proposals.
	var driftedConnectorGuids = {};

	for (var rb = 0; rb < baseRelIds.length; rb++) {
		var relSchemaId = baseRelIds[rb];
		var baseRel = base.relById[relSchemaId];
		var workRel = work.relBySchema[relSchemaId];
		if (!workRel) {
			// The canonical relationship has no schema-anchored connector in the work model.
			// Before declaring it REMOVED, check whether a connector with the same endpoints is
			// still present but lost its schema_id anchor (EA rewrites / re-draws connectors and
			// drops the anchor). If so, this is an anchor-drift, NOT a deletion: keep it as an
			// updateRelationship carrying a reAnchor hint so the agent re-binds rather than deletes.
			var srcObj = work.elementBySchema[String(baseRel.sourceId)];
			var tgtObj = work.elementBySchema[String(baseRel.targetId)];
			var drifted = (srcObj && tgtObj) ? connectorByEndpoints(work, srcObj.objectId, tgtObj.objectId) : null;
			if (drifted) {
				var driftFields = {};
				if (normText(baseRel.name) !== normText(drifted.name)) { driftFields.name = drifted.name; }
				if (normText(baseRel.description) !== normText(drifted.description)) { driftFields.description = drifted.description; }
				if (normText(baseRel.type) !== normText(drifted.archimateType)) { driftFields.type = drifted.archimateType; }
				var driftAttrDiff = diffAttrs(baseRel.attributes || [], drifted.attributes || []);
				if (driftAttrDiff.changed) { driftFields.attributes = drifted.attributes; }
				driftFields.sourceId = String(baseRel.sourceId);
				driftFields.targetId = String(baseRel.targetId);
				driftFields.reAnchor = { note: 'relationship connector exists in EA but its schema_id anchor was lost; re-anchor to ' + relSchemaId, eaGuid: drifted.eaGuid };
				driftedConnectorGuids[String(drifted.eaGuid)] = true;
				push({ op: 'updateRelationship', kind: 'relationship', id: relSchemaId, fields: driftFields, sourceEa: { guid: drifted.eaGuid } });
				continue;
			}
			push({ op: 'removeRelationship', kind: 'relationship', id: relSchemaId, sourceEa: {} });
			continue;
		}
		var rfields = {};
		if (normText(baseRel.name) !== normText(workRel.name)) { rfields.name = workRel.name; }
		if (normText(baseRel.description) !== normText(workRel.description)) { rfields.description = workRel.description; }
		if (normText(baseRel.type) !== normText(workRel.archimateType)) { rfields.type = workRel.archimateType; }
		var relAttrDiff = diffAttrs(baseRel.attributes || [], workRel.attributes || []);
		if (relAttrDiff.changed) { rfields.attributes = workRel.attributes; }
		var s = schemaOfObject(work, workRel.sourceObjectId);
		var t = schemaOfObject(work, workRel.targetObjectId);
		var src = (s && typeof s === 'object') ? null : s;
		var tgt = (t && typeof t === 'object') ? null : t;
		if ((src || '') !== (baseRel.sourceId || '')) { rfields.sourceId = src; }
		if ((tgt || '') !== (baseRel.targetId || '')) { rfields.targetId = tgt; }
		if (ObjectKeysCount(rfields) > 0) {
			push({ op: 'updateRelationship', kind: 'relationship', id: relSchemaId, fields: rfields, sourceEa: { guid: workRel.eaGuid } });
		}
	}

	var workRelOrphan = 0;
	for (var wrs in work.relBySchema) {
		if (work.relBySchema.hasOwnProperty(wrs) && !base.relById.hasOwnProperty(wrs)) { workRelOrphan++; }
	}
	summary.orphanAnchored += workRelOrphan;

	// unanchored NEW connectors in work (human drew fresh links)
	for (var cg in work.relByGuid) {
		if (!work.relByGuid.hasOwnProperty(cg)) { continue; }
		var recRel = work.relByGuid[cg];
		if (recRel.schemaId) { continue; }
		if (driftedConnectorGuids[String(recRel.eaGuid)]) { continue; }
		var srcE = work.elementByGuid[guidOfObject(work, recRel.sourceObjectId)];
		var tgtE = work.elementByGuid[guidOfObject(work, recRel.targetObjectId)];
		var srcContext = srcE ? elementCanonicalContext(work, srcE) : false;
		var tgtContext = tgtE ? elementCanonicalContext(work, tgtE) : false;
		if (!srcContext && !tgtContext) { summary.outOfScopeNew++; continue; }
		var relViewIds = [];
		for (var dj in work.placements) {
			if (!work.placements.hasOwnProperty(dj)) { continue; }
			var v = work.viewByDiagram[parseInt(dj, 10)];
			if (v && work.placements[dj].hasOwnProperty(recRel.sourceObjectId) && work.placements[dj].hasOwnProperty(recRel.targetObjectId)) { relViewIds.push(v); }
		}
		var srcRef = srcE ? (srcE.schemaId || { newGuid: srcE.eaGuid }) : null;
		var tgtRef = tgtE ? (tgtE.schemaId || { newGuid: tgtE.eaGuid }) : null;
		push({
			op: 'addRelationship', kind: 'relationship', id: null,
			proposed: {
				name: recRel.name === '' ? undefined : recRel.name,
				description: recRel.description === '' ? undefined : recRel.description,
				sourceRef: srcRef, targetRef: tgtRef,
				eaType: { connectorType: recRel.connectorType, stereotype: recRel.stereotype },
				viewIds: relViewIds.length > 0 ? relViewIds : undefined,
				attributes: recRel.attributes.length > 0 ? recRel.attributes : undefined
			},
			sourceEa: { guid: cg, connectorId: recRel.connectorId }
		});
	}

	// --- views: add / remove / update(name+description) / membership -------------
	// human-drawn diagrams with no canonical view_id (no schema_view_id anchor, Name not in
	// canonical) are NEW views the user added in EA.
	for (var ed = 0; ed < (work.extraDiagrams || []).length; ed++) {
		var exDiag = work.extraDiagrams[ed];
		push({
			op: 'addView', kind: 'view', id: null,
			proposed: {
				view_name: exDiag.view_name,
				description: exDiag.description === '' ? undefined : exDiag.description
			},
			sourceEa: { guid: exDiag.eaGuid, diagramId: exDiag.diagramId }
		});
	}
	var allViewIds = {};
	for (var bv0 in base.viewById) { if (base.viewById.hasOwnProperty(bv0)) { allViewIds[bv0] = true; } }
	for (var wv0 in work.diagramsByView) { if (work.diagramsByView.hasOwnProperty(wv0)) { allViewIds[wv0] = true; } }
	for (var vid in allViewIds) {
		if (!allViewIds.hasOwnProperty(vid)) { continue; }
		var baseView = base.viewById[vid];
		var wDiagram = work.diagramsByView[vid];
		if (!baseView && wDiagram) {
			// new view present in EA, absent in canonical -> addView
			push({
				op: 'addView', kind: 'view', id: null,
				proposed: {
					view_name: wDiagram.view_name,
					description: wDiagram.description === '' ? undefined : wDiagram.description
				},
				sourceEa: { guid: wDiagram.eaGuid, diagramId: wDiagram.diagramId }
			});
			continue;
		}
		if (baseView && !wDiagram) {
			// canonical view absent in EA -> removeView (confirm-first)
			push({ op: 'removeView', kind: 'view', id: vid, sourceEa: {} });
			continue;
		}
		if (!baseView || !wDiagram) { continue; }
		// view name / description changed
		var vfields = {};
		if (normText(baseView.view_name) !== normText(wDiagram.view_name)) { vfields.view_name = wDiagram.view_name; }
		if (normText(baseView.description) !== normText(wDiagram.description)) { vfields.description = wDiagram.description; }
		// membership (anchored objects only, still in the model)
		var baseMembers = baseView.included_elements;
		var workMembersIds = [];
		var wdiag = wDiagram.diagramId;
		if (work.placements.hasOwnProperty(wdiag)) {
			for (var mobj in work.placements[wdiag]) {
				if (work.placements[wdiag].hasOwnProperty(mobj)) {
					var mrec = elemByObjectId(work, parseInt(mobj, 10));
					if (mrec && mrec.schemaId) { workMembersIds.push(mrec.schemaId); }
				}
			}
		}
		var addMembers = [];
		for (var mi = 0; mi < workMembersIds.length; mi++) {
			if (!arrayContains(baseMembers, workMembersIds[mi])) { addMembers.push(workMembersIds[mi]); }
		}
		var removeMembers = [];
		for (var bmi = 0; bmi < baseMembers.length; bmi++) {
			var bId = baseMembers[bmi];
			if (!arrayContains(workMembersIds, bId)) {
				if (work.elementBySchema.hasOwnProperty(bId)) { removeMembers.push(bId); }
			}
		}
		// build a single updateView carrying every detected change
		var updView = { op: 'updateView', kind: 'view', viewId: vid, sourceEa: {} };
		var vChanged = false;
		if (vfields.view_name) { updView.view_name = vfields.view_name; vChanged = true; }
		if (vfields.description) { updView.description = vfields.description; vChanged = true; }
		if (addMembers.length > 0) { updView.addMembers = addMembers; vChanged = true; }
		if (removeMembers.length > 0) { updView.removeMembers = removeMembers; vChanged = true; }
		if (vChanged) { push(updView); }
	}

	summary.metaUnchanged = true; // canonical is the mirror source; diff never reads kg_sync_meta
	summary.removedUnanchored = 0; // no baseline unanchored objects (canonical has none)
	return { proposals: proposals, summary: summary };
}

function ObjectKeysCount(o) {
	var n = 0;
	for (var k in o) { if (o.hasOwnProperty(k)) { n++; } }
	return n;
}

// ---------------------------------------------------------------------------
// Output rendering (JSON + Markdown) — matches ea-human-diff.js shape
// ---------------------------------------------------------------------------
function jsonEscape(str) {
	if (str == null || typeof str == 'undefined') { return ''; }
	var s = String(str);
	return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
}

function isoNow() {
	var d = new Date();
	function f(n) { return n < 10 ? '0' + n : n; }
	return d.getFullYear() + '-' + f(d.getMonth() + 1) + '-' + f(d.getDate()) +
		'T' + f(d.getHours()) + ':' + f(d.getMinutes()) + ':' + f(d.getSeconds()) + 'Z';
}

function buildJsonResult(args) {
	return {
		format: 'archgraph-ea-human-diff',
		version: 1,
		source: { base: args.base, work: args.work },
		baselineCommit: args.baselineCommit || null,
		extractedAt: isoNow(),
		summary: args.summary,
		proposals: args.proposals
	};
}

function renderMarkdown(result) {
	var s = result.summary;
	var lines = [];
	lines.push('# EA 人类草稿语义 diff（extract-human-draft）');
	lines.push('');
	lines.push('- 基线（canonical JSON）：`' + result.source.base + '`');
	lines.push('- 工作区（live EA model）：`' + result.source.work + '`');
	if (result.baselineCommit) { lines.push('- 基线 commit：`' + result.baselineCommit + '`'); }
	lines.push('- 提取时间：' + result.extractedAt);
	lines.push('');
	lines.push('## 摘要');
	lines.push('');
	lines.push('| 操作 | 数量 |');
	lines.push('| --- | --- |');
	var opOrder = ['addElement', 'updateElement', 'removeElement', 'addRelationship', 'updateRelationship', 'removeRelationship', 'addView', 'updateView', 'removeView'];
	var labels = {
		addElement: '新增元素', updateElement: '更新元素', removeElement: '删除元素',
		addRelationship: '新增关系', updateRelationship: '更新关系', removeRelationship: '删除关系',
		addView: '新增视图', updateView: '更新视图', removeView: '删除视图'
	};
	for (var i = 0; i < opOrder.length; i++) {
		var op = opOrder[i];
		lines.push('| ' + labels[op] + '（' + op + '） | ' + (s[op] || 0) + ' |');
	}
	lines.push('| 纯几何移动（不产出，语义优先排除） | ' + (s.layoutOnly || 0) + ' |');
	lines.push('| 超出 canonical 作用域的新对象（跳过） | ' + (s.outOfScopeNew || 0) + ' |');
	lines.push('| 删除的无锚对象（从未入 canonical，跳过） | ' + (s.removedUnanchored || 0) + ' |');
	lines.push('| 镜像（kg_sync_meta）未读（baseline=canonical） | 是 |');
	lines.push('');
	if (result.proposals.length === 0) {
		lines.push('> 未检测到 canonical 语义提议（纯几何/超出作用域改动不计）。');
		lines.push('');
	} else {
		// Machine-readable proposal set, embedded verbatim — compact, no per-item prose.
		lines.push('## 提议集（JSON）');
		lines.push('');
		lines.push('```json');
		lines.push(compactJson(result.proposals));
		lines.push('```');
		lines.push('');
	}
	// Object.filter may be absent in JScript 5.8; the above uses manual join. Guard:
	lines.push('> 本 diff 仅作提取：基于 EA 可见对象模型（schema_id 锚 tag 对齐），基线为 canonical JSON（未读 kg_sync_meta）；几何不进 canonical；status 不进顶层字段（经 attributes 通道）。');
	lines.push('');
	return lines.join('\n');
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
function main() {
	Repository.EnsureOutputVisible('Script');
	Session.Output('extract-human-draft: starting...');

	var root = repoRoot();
	if (root == '') {
		Session.Output('ERROR: cannot resolve model path (Repository.ConnectionString empty?). Aborting.');
		return;
	}
	Session.Output('extract-human-draft: model repo root = ' + root);

	// baseline graph path: EA_HEADLESS_GRAPH override, else <root>\design\KG\SystemArchitecture.json
	var graphPath = '';
	if (typeof EA_HEADLESS_GRAPH != 'undefined' && EA_HEADLESS_GRAPH != '') {
		graphPath = String(EA_HEADLESS_GRAPH);
	} else {
		graphPath = root + '\\design\\KG\\SystemArchitecture.json';
	}
	// output stem: EA_HEADLESS_OUTPUT override, else <root>\results\human-draft
	var outStem = '';
	if (typeof EA_HEADLESS_OUTPUT != 'undefined' && EA_HEADLESS_OUTPUT != '') {
		outStem = String(EA_HEADLESS_OUTPUT);
	} else {
		outStem = root + '\\results\\human-draft';
	}

	Session.Output('extract-human-draft: baseline graph = ' + graphPath);
	Session.Output('extract-human-draft: output stem = ' + outStem);

	var base = readCanonical(graphPath);
	if (base == null) {
		Session.Output('ERROR: cannot read baseline graph ' + graphPath + ' (or JSON parse failed). Aborting.');
		return;
	}
	Session.Output('extract-human-draft: baseline elements=' + ObjectKeysCount(base.elementById)
		+ ' relationships=' + ObjectKeysCount(base.relById) + ' views=' + ObjectKeysCount(base.viewById));

	var work = readWork(base.viewById);
	Session.Output('extract-human-draft: live model elements(schema=' + ObjectKeysCount(work.elementBySchema)
		+ ' total=' + ObjectKeysCount(work.elementByGuid) + ') relationships(schema=' + ObjectKeysCount(work.relBySchema)
		+ ' total=' + ObjectKeysCount(work.relByGuid) + ') diagrams=' + ObjectKeysCount(work.diagramsByView));

	var out = semanticDiff(base, work);
	var baselineCommit = '';
	try {
		var fso = new ActiveXObject('Scripting.FileSystemObject');
		var gitRoot = fso.GetParentFolderName(root);
		var wsh = new ActiveXObject('WScript.Shell');
		var exec = wsh.Exec('cmd /c cd /d "' + root + '" && git rev-parse --short HEAD 2>nul');
		var commitOut = '';
		while (!exec.StdOut.AtEndOfStream) { commitOut += exec.StdOut.ReadLine(); }
		baselineCommit = trimString(commitOut);
	} catch (e) { baselineCommit = ''; }

	var result = buildJsonResult({
		base: graphPath,
		work: work.modelPath,
		baselineCommit: baselineCommit,
		summary: out.summary,
		proposals: out.proposals
	});

	var jsonText = JSON.stringify(result, null, 2);
	var mdText = renderMarkdown(result);
	writeTextUtf8(outStem + '.json', jsonText);
	writeTextUtf8(outStem + '.md', mdText);
	Session.Output('extract-human-draft: written ' + outStem + '.json + ' + outStem + '.md');
	Session.Output('extract-human-draft: summary ' + JSON.stringify(out.summary));
}

main();
