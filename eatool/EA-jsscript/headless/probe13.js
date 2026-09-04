function arg(i, d) { try { var v = WScript.Arguments(i); if (v != null && v != '') { return '' + v; } } catch (e) { } return d; }
function P(m) { try { WScript.Echo('[' + new Date().getTime() + '] ' + m); } catch (e) { } }
var FEAP = arg(0, '');
P('feap=' + FEAP);
var repo = new ActiveXObject('EA.Repository');
P('open=' + repo.OpenFile(FEAP));
function runQuery(sql) { try { return '' + repo.SQLQuery(sql); } catch (e) { return 'ERR:' + e.message; } }
function exec(sql, label) {
  try {
    var ok = repo.Execute(sql);
    P('EXEC ' + label + ' ok=' + ok + ' len=' + sql.length);
    return ok !== false;
  } catch (e) {
    P('EXECERR ' + label + ' :: ' + e.message + ' len=' + sql.length);
    return false;
  }
}
function countAliases(prefix) {
  var xml = runQuery("SELECT COUNT(*) AS C FROM t_object WHERE Alias LIKE '" + prefix + "%'");
  var m = /<C>(\d+)<\/C>/i.exec(xml);
  return m ? m[1] : '?';
}
function buildRows(n, prefix) {
  var parts = [];
  for (var i = 0; i < n; i++) {
    var g = prefix + '-' + ('000' + i).slice(-3) + '-' + ('0000000' + i).slice(-7);
    parts.push("('Class','" + prefix + i + "','" + g + "','{" + g + "-1111-2222-3333-444444444444}',85,0,'Proposed')");
  }
  return parts.join(',');
}
// 2-row
var two = "INSERT INTO t_object (OBJECT_TYPE,NAME,ALIAS,EA_GUID,PACKAGE_ID,PARENTID,STATUS) VALUES " + buildRows(2, 'mrow2_');
exec(two, 'multirow-2');
P('count mrow2_ = ' + countAliases('mrow2_'));
// 50-row
var fifty = "INSERT INTO t_object (OBJECT_TYPE,NAME,ALIAS,EA_GUID,PACKAGE_ID,PARENTID,STATUS) VALUES " + buildRows(50, 'mrow50_');
exec(fifty, 'multirow-50');
P('count mrow50_ = ' + countAliases('mrow50_'));
// 300-row (large statement)
var three = "INSERT INTO t_object (OBJECT_TYPE,NAME,ALIAS,EA_GUID,PACKAGE_ID,PARENTID,STATUS) VALUES " + buildRows(300, 'mrow300_');
exec(three, 'multirow-300');
P('count mrow300_ = ' + countAliases('mrow300_'));
// multirow t_objectproperties (owner = two elements created above? use the 2-row aliases' object ids via subquery-less approach: read ids first)
var ids = [];
var xml2 = runQuery("SELECT Object_ID FROM t_object WHERE Alias LIKE 'mrow2_%' ORDER BY Alias");
var rm = /<OBJECT_ID>(\d+)<\/OBJECT_ID>/gi; var mm;
while ((mm = rm.exec(xml2)) != null) { ids.push(mm[1]); }
if (ids.length >= 2) {
  var tagRows = [];
  for (var t = 0; t < 4; t++) {
    tagRows.push("(" + ids[0] + ", 'prop_a" + t + "', 'v" + t + "', 'm" + t + "')");
  }
  for (var u = 0; u < 4; u++) {
    tagRows.push("(" + ids[1] + ", 'prop_b" + u + "', 'v" + u + "', 'm" + u + "')");
  }
  exec("INSERT INTO t_objectproperties (Object_ID, Property, \"Value\", Notes) VALUES " + tagRows.join(','), 'multirow-objprop');
  var xml3 = runQuery("SELECT COUNT(*) AS C FROM t_objectproperties WHERE Object_ID IN (" + ids.join(',') + ")");
  P('count objprop rows = ' + (/<C>(\d+)<\/C>/i.exec(xml3) ? RegExp.$1 : '?'));
} else {
  P('objprop skip: ids=' + ids.length);
}
repo.CloseFile(); repo.Exit(); P('done'); WScript.Quit(0);
