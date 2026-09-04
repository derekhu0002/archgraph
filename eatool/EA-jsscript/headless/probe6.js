function arg(i, d) { try { var v = WScript.Arguments(i); if (v != null && v != '') { return '' + v; } } catch (e) { } return d; }
function P(m) { try { WScript.Echo('[' + new Date().getTime() + '] ' + m); } catch (e) { } }
var FEAP = arg(0, '');
P('feap=' + FEAP);
var repo = new ActiveXObject('EA.Repository');
P('open=' + repo.OpenFile(FEAP));

function runQuery(sql) {
  try { return '' + repo.SQLQuery(sql); } catch (e) { return 'ERR:' + e.message; }
}
function extractTags(xml, tag) {
  var out = [];
  var re = new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>', 'gi');
  var m;
  while ((m = re.exec(xml)) != null) { out.push(m[1].replace(/^\s+|\s+$/g, '')); }
  return out;
}
function fieldNames(table) {
  var xml = runQuery("SELECT RDB$FIELD_NAME AS FN, RDB$FIELD_POSITION AS POS FROM RDB$RELATION_FIELDS WHERE RDB$RELATION_NAME='" + table + "' ORDER BY RDB$FIELD_POSITION");
  return xml;
}
var tables = ['T_OBJECT', 'T_CONNECTOR', 'T_DIAGRAM', 'T_PACKAGE', 'T_OBJECTPROPERTIES', 'T_CONNECTORPROPERTIES', 'T_DIAGRAMOBJECTS', 'T_DIAGRAMLINKS'];
for (var t = 0; t < tables.length; t++) {
  var xml = fieldNames(tables[t]);
  if (xml.indexOf('ERR:') == 0) { P(tables[t] + ' :: ' + xml); continue; }
  var fns = extractTags(xml, 'FN');
  P(tables[t] + ' [' + fns.length + '] :: ' + fns.join(', '));
}
// SELECT * on the four write-relevant tables (first row) to confirm the live column set.
var stars = ['T_OBJECT', 'T_CONNECTOR', 'T_DIAGRAM', 'T_PACKAGE', 'T_OBJECTPROPERTIES', 'T_CONNECTORPROPERTIES'];
for (var s = 0; s < stars.length; s++) {
  var xml2 = runQuery('SELECT FIRST 1 * FROM ' + stars[s]);
  if (xml2.indexOf('ERR:') == 0) { P('SELECT* ' + stars[s] + ' :: ' + xml2); continue; }
  var cols = [];
  var colRe = /<([A-Z][A-Z0-9_]*?)>([\s\S]*?)<\/\1>/gi;
  var m2;
  while ((m2 = colRe.exec(xml2)) != null) { if (cols.indexOf(m2[1]) < 0) { cols.push(m2[1]); } }
  P('SELECT* ' + stars[s] + ' cols[' + cols.length + '] :: ' + cols.join(', '));
}
repo.CloseFile(); repo.Exit(); P('done'); WScript.Quit(0);
