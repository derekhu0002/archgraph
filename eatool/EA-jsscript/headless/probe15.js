function arg(i, d) { try { var v = WScript.Arguments(i); if (v != null && v != '') { return '' + v; } } catch (e) { } return d; }
function P(m) { try { WScript.Echo('[' + new Date().getTime() + '] ' + m); } catch (e) { } }
var FEAP = arg(0, '');
P('feap=' + FEAP);
var repo = null;
try {
  repo = new ActiveXObject('EA.Repository');
  P('repo created');
} catch (e) {
  P('REPO_CREATE_ERR ' + e.message);
  WScript.Quit(3);
}
try { P('open=' + repo.OpenFile(FEAP)); } catch (e) { P('OPEN_ERR ' + e.message); WScript.Quit(3); }
P('openfile-ok');
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
function guidOf(p, i) {
  var g = p + '-' + ('00000' + i).slice(-5);
  return '{' + g + '-1111-2222-3333-444444444444}';
}
function oneRow(prefix, i) {
  return "('Class','" + prefix + i + "','" + prefix + i + "','" + guidOf(prefix, i) + "',1,0,'Proposed')";
}
function multiRow(prefix, n) {
  var parts = [];
  for (var i = 0; i < n; i++) { parts.push(oneRow(prefix, i)); }
  return 'INSERT INTO t_object (Object_Type, Name, Alias, ea_guid, Package_ID, ParentID, Status) VALUES ' + parts.join(',');
}
exec("INSERT INTO t_object (Object_Type, Name, Alias, ea_guid, Package_ID, ParentID, Status) VALUES ('Class','ctl0','ctl0','{ctl0-1111-2222-3333-444444444444}',1,0,'Proposed')", 'single-ctl');
P('count ctl0 = ' + countAliases('ctl0'));
exec(multiRow('mq2_', 2), 'multirow-2');
P('count mq2_ = ' + countAliases('mq2_'));
exec(multiRow('mq50_', 50), 'multirow-50');
P('count mq50_ = ' + countAliases('mq50_'));
exec(multiRow('mq200_', 200), 'multirow-200');
P('count mq200_ = ' + countAliases('mq200_'));
repo.CloseFile(); repo.Exit(); P('done'); WScript.Quit(0);
