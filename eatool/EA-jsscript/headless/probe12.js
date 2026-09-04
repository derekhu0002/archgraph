function arg(i, d) { try { var v = WScript.Arguments(i); if (v != null && v != '') { return '' + v; } } catch (e) { } return d; }
function P(m) { try { WScript.Echo('[' + new Date().getTime() + '] ' + m); } catch (e) { } }
var FEAP = arg(0, '');
P('feap=' + FEAP);
var repo = new ActiveXObject('EA.Repository');
P('open=' + repo.OpenFile(FEAP));
function runQuery(sql) { try { return '' + repo.SQLQuery(sql); } catch (e) { return 'ERR:' + e.message; } }
function exec(sql, label) {
  P('EXEC ' + label + ' :: ' + sql);
  try {
    var ok = repo.Execute(sql);
    P('EXECRES ' + label + ' ok=' + ok);
    return ok !== false;
  } catch (e) {
    P('EXECERR ' + label + ' :: ' + e.message);
    return false;
  }
}
function firstInt(xml, tag) {
  var re = new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>', 'i');
  var m = re.exec(xml);
  return m ? m[1].replace(/^\s+|\s+$/g, '') : '';
}
var guid = '{aaaaaaaa-1111-2222-3333-444444444444}';
var pkgId = 85;
var ok1 = exec("INSERT INTO t_object (Object_Type, ea_guid, Name, Stereotype, Note, Alias, Package_ID, ParentID, Status) VALUES ('Class', '" + guid + "', '__sql_probe_smoke__', 'Business Actor', 'note', '__probe__', " + pkgId + ", 0, 'Proposed')", 'insert-element');
var rb = runQuery("SELECT Object_ID FROM t_object WHERE ea_guid='" + guid + "'");
var objId = firstInt(rb, 'Object_ID');
P('READBACK element Object_ID=' + objId + ' raw=' + rb.slice(0, 120));
if (objId != '') {
  exec("UPDATE t_object SET Name='__sql_probe_smoke2__' WHERE Object_ID=" + objId, 'update-element');
  exec("INSERT INTO t_objectproperties (Object_ID, Property, \"Value\", Notes) VALUES (" + objId + ", 'schema_id', '__probe__', 'memo')", 'insert-objectprop');
  var rbp = runQuery("SELECT PropertyID FROM t_objectproperties WHERE Object_ID=" + objId + " AND Property='schema_id'");
  P('READBACK objectprop PropertyID=' + firstInt(rbp, 'PROPERTYID') + ' raw=' + rbp.slice(0, 120));
}
var cguid = '{bbbbbbbb-1111-2222-3333-444444444444}';
var ok2 = exec("INSERT INTO t_connector (Name, Connector_Type, Start_Object_ID, End_Object_ID, Stereotype, Notes, Direction, Alias, ea_guid) VALUES ('__rel_probe__', 'Association', 1249, 1240, 'Association', 'note', '', '__probe_rel__', '" + cguid + "')", 'insert-connector');
var rbc = runQuery("SELECT Connector_ID FROM t_connector WHERE ea_guid='" + cguid + "'");
var conId = firstInt(rbc, 'CONNECTOR_ID');
P('READBACK connector Connector_ID=' + conId + ' raw=' + rbc.slice(0, 120));
if (conId != '') {
  exec("INSERT INTO t_connectortag (ElementID, Property, VALUE, Notes) VALUES (" + conId + ", 'schema_id', '__probe_rel__', 'memo')", 'insert-connectag');
  var rbt = runQuery("SELECT PropertyID FROM t_connectortag WHERE ElementID=" + conId + " AND Property='schema_id'");
  P('READBACK connectag PropertyID=' + firstInt(rbt, 'PROPERTYID') + ' raw=' + rbt.slice(0, 120));
}
var dguid = '{cccccccc-1111-2222-3333-444444444444}';
exec("INSERT INTO t_diagram (Name, Diagram_Type, Package_ID, ParentID, ea_guid, StyleEx, Notes) VALUES ('__probe_diagram__', 'Logical', " + pkgId + ", 0, '" + dguid + "', 'l=0;r=0;t=0;b=0;', '')", 'insert-diagram');
var rbd = runQuery("SELECT Diagram_ID FROM t_diagram WHERE ea_guid='" + dguid + "'");
P('READBACK diagram Diagram_ID=' + firstInt(rbd, 'DIAGRAM_ID') + ' raw=' + rbd.slice(0, 120));
repo.CloseFile(); repo.Exit(); P('done'); WScript.Quit(0);
